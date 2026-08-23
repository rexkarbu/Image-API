import { db } from "@/db";
import { apiKeys, apiKeyAuditEvents, user } from "@/db/schema";
import {
  generateFullApiKey,
  deriveApiKeyDisplayPrefix,
  deriveApiKeyStatus,
  canManageApiKeys,
  isValidApiKeyFormat,
  hashApiKey,
  DerivedApiKeyStatus,
} from "@/lib/crypto/api-keys";
import {
  apiKeyNameSchema,
  CreateApiKeyInput,
  ApiKeyStatusFilter,
  ApiKeyRotationMode,
} from "@/lib/validations/api-keys";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import crypto from "node:crypto";

export interface ApiKeyDto {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  displayPrefix: string;
  scopes: string;
  status: DerivedApiKeyStatus;
  rawStatus: "active" | "revoked";
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserName?: string | null;
}

export interface CreateApiKeyResult {
  key: ApiKeyDto;
  plaintextKey: string;
}

export interface RotateApiKeyResult {
  newKey: ApiKeyDto;
  oldKey: ApiKeyDto;
  plaintextKey: string;
}

export interface VerifiedApiKeyIdentity {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
}

/**
 * Maps a database API key row (and optional creator user name) to a safe, serialized DTO.
 * Explicitly omits `keyHash`.
 */
function toApiKeyDto(
  row: {
    id: string;
    organizationId: string;
    name: string;
    keyPrefix: string;
    scopes: string;
    status: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  creatorName?: string | null
): ApiKeyDto {
  const derivedStatus = deriveApiKeyStatus(row.status, row.expiresAt);

  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    displayPrefix: deriveApiKeyDisplayPrefix(row.keyPrefix),
    scopes: row.scopes,
    status: derivedStatus,
    rawStatus: row.status as "active" | "revoked",
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserName: creatorName ?? null,
  };
}

/**
 * Creates a new API key for the trusted organization in a single atomic transaction.
 * Appends a 'created' audit event.
 * Returns the safe DTO and the full plaintext key exactly once.
 */
export async function createApiKey(
  trustedContext: {
    organizationId: string;
    userId: string;
    role: string;
  },
  input: CreateApiKeyInput
): Promise<CreateApiKeyResult> {
  if (!canManageApiKeys(trustedContext.role)) {
    throw new Error("Unauthorized: Only organization owners and admins can create API keys.");
  }

  const validatedName = apiKeyNameSchema.parse(input.name);
  const { plaintextKey, keyPrefix, keyHash } = generateFullApiKey();
  const keyId = crypto.randomUUID();
  const now = new Date();

  const createdRow = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(apiKeys)
      .values({
        id: keyId,
        organizationId: trustedContext.organizationId,
        createdByUserId: trustedContext.userId,
        name: validatedName,
        keyPrefix,
        keyHash,
        scopes: input.scopes || "image:transform",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(apiKeyAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId: trustedContext.organizationId,
      apiKeyId: keyId,
      actorUserId: trustedContext.userId,
      eventType: "created",
      createdAt: now,
    });

    return inserted;
  });

  return {
    key: toApiKeyDto(createdRow),
    plaintextKey,
  };
}

/**
 * Lists all API keys belonging strictly to the trusted organization.
 * Never selects or returns `keyHash`.
 * Supports filtering by derived status (`all`, `active`, `expired`, `revoked`).
 * Sorts usable keys first, then newest keys first.
 */
export async function listApiKeys(
  trustedContext: {
    organizationId: string;
  },
  filter: ApiKeyStatusFilter = "all"
): Promise<ApiKeyDto[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      status: apiKeys.status,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
      updatedAt: apiKeys.updatedAt,
      creatorName: user.name,
    })
    .from(apiKeys)
    .leftJoin(user, eq(apiKeys.createdByUserId, user.id))
    .where(eq(apiKeys.organizationId, trustedContext.organizationId))
    .orderBy(desc(apiKeys.createdAt));

  const dtos = rows.map((r) =>
    toApiKeyDto(
      {
        id: r.id,
        organizationId: r.organizationId,
        name: r.name,
        keyPrefix: r.keyPrefix,
        scopes: r.scopes,
        status: r.status,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
      r.creatorName
    )
  );

  // Filter based on effective derived status
  const filtered = dtos.filter((dto) => {
    if (filter === "all") return true;
    return dto.status === filter;
  });

  // Sort order: active first, then expired, then revoked; newest createdAt within each group
  const statusRank: Record<DerivedApiKeyStatus, number> = {
    active: 1,
    expired: 2,
    revoked: 3,
  };

  return filtered.sort((a, b) => {
    const rankDiff = statusRank[a.status] - statusRank[b.status];
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Revokes an API key idempotently.
 * Scoped strictly to the trusted organization ID.
 * Appends a single 'revoked' audit event on state transition.
 */
export async function revokeApiKey(
  trustedContext: {
    organizationId: string;
    userId: string;
    role: string;
  },
  keyId: string
): Promise<ApiKeyDto> {
  if (!canManageApiKeys(trustedContext.role)) {
    throw new Error("Unauthorized: Only organization owners and admins can revoke API keys.");
  }

  const now = new Date();

  const updatedRow = await db.transaction(async (tx) => {
    // 1. Fetch key strictly within trusted organization
    const [existing] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, trustedContext.organizationId)));

    if (!existing) {
      throw new Error("API key not found.");
    }

    // Idempotent: if already revoked, return existing without new audit event
    if (existing.status === "revoked") {
      return existing;
    }

    // 2. Perform revocation
    const [updated] = await tx
      .update(apiKeys)
      .set({
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, trustedContext.organizationId)))
      .returning();

    // 3. Record audit event
    await tx.insert(apiKeyAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId: trustedContext.organizationId,
      apiKeyId: keyId,
      actorUserId: trustedContext.userId,
      eventType: "revoked",
      createdAt: now,
    });

    return updated;
  });

  return toApiKeyDto(updatedRow);
}

/**
 * Rotates an active, usable API key.
 * Supports:
 * - 'immediate': Revokes old key immediately and activates replacement key.
 * - 'grace_24h': Keeps old key active with a 24-hour expiration window.
 *
 * Atomically executes within a database transaction with audit logging.
 */
export async function rotateApiKey(
  trustedContext: {
    organizationId: string;
    userId: string;
    role: string;
  },
  keyId: string,
  mode: ApiKeyRotationMode
): Promise<RotateApiKeyResult> {
  if (!canManageApiKeys(trustedContext.role)) {
    throw new Error("Unauthorized: Only organization owners and admins can rotate API keys.");
  }

  const now = new Date();
  const { plaintextKey, keyPrefix, keyHash } = generateFullApiKey();
  const newKeyId = crypto.randomUUID();

  const result = await db.transaction(async (tx) => {
    // 1. Fetch old key strictly within organization
    const [oldKey] = await tx
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, trustedContext.organizationId)));

    if (!oldKey) {
      throw new Error("API key not found.");
    }

    const currentStatus = deriveApiKeyStatus(oldKey.status, oldKey.expiresAt, now);
    if (currentStatus !== "active") {
      throw new Error(`Cannot rotate an API key that is already ${currentStatus}.`);
    }

    // 2. Insert new replacement key
    const [newKeyRow] = await tx
      .insert(apiKeys)
      .values({
        id: newKeyId,
        organizationId: trustedContext.organizationId,
        createdByUserId: trustedContext.userId,
        name: oldKey.name,
        keyPrefix,
        keyHash,
        scopes: oldKey.scopes,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // 3. Record rotation_created audit event
    await tx.insert(apiKeyAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId: trustedContext.organizationId,
      apiKeyId: newKeyId,
      relatedApiKeyId: oldKey.id,
      actorUserId: trustedContext.userId,
      eventType: "rotation_created",
      createdAt: now,
    });

    let updatedOldKeyRow = oldKey;

    if (mode === "immediate") {
      // Immediate mode: revoke old key now
      const [revokedOld] = await tx
        .update(apiKeys)
        .set({
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        })
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, trustedContext.organizationId)))
        .returning();

      await tx.insert(apiKeyAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId: trustedContext.organizationId,
        apiKeyId: oldKey.id,
        relatedApiKeyId: newKeyId,
        actorUserId: trustedContext.userId,
        eventType: "revoked",
        createdAt: now,
      });

      updatedOldKeyRow = revokedOld;
    } else {
      // Grace 24h mode: set expiry to min(existingExpiry, now + 24h)
      const graceExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const targetExpiry =
        oldKey.expiresAt && oldKey.expiresAt.getTime() < graceExpiry.getTime()
          ? oldKey.expiresAt
          : graceExpiry;

      const [graceOld] = await tx
        .update(apiKeys)
        .set({
          expiresAt: targetExpiry,
          updatedAt: now,
        })
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, trustedContext.organizationId)))
        .returning();

      await tx.insert(apiKeyAuditEvents).values({
        id: crypto.randomUUID(),
        organizationId: trustedContext.organizationId,
        apiKeyId: oldKey.id,
        relatedApiKeyId: newKeyId,
        actorUserId: trustedContext.userId,
        eventType: "expiration_scheduled",
        createdAt: now,
      });

      updatedOldKeyRow = graceOld;
    }

    return {
      newKeyRow,
      updatedOldKeyRow,
    };
  });

  return {
    newKey: toApiKeyDto(result.newKeyRow),
    oldKey: toApiKeyDto(result.updatedOldKeyRow),
    plaintextKey,
  };
}

/**
 * Server-only API key verification service foundation.
 * Validates format, SHA-256 hash lookup, active status, and required scope.
 * Employs a generic error on any failure to avoid disclosing key existence or status.
 * Throttles lastUsedAt write to at most once per 5 minutes.
 */
export async function verifyApiKey(
  rawKey: string,
  requiredScope: string = "image:transform",
  now: Date = new Date()
): Promise<VerifiedApiKeyIdentity> {
  const genericAuthError = new Error("Invalid API key.");

  // 1. Reject malformed keys before touching the database
  if (!isValidApiKeyFormat(rawKey)) {
    throw genericAuthError;
  }

  // 2. Compute SHA-256 hash
  const keyHash = hashApiKey(rawKey);

  // 3. Look up by unique hash
  const [keyRow] = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      scopes: apiKeys.scopes,
      status: apiKeys.status,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash));

  if (!keyRow) {
    throw genericAuthError;
  }

  // 4. Reject revoked or expired keys
  const effectiveStatus = deriveApiKeyStatus(keyRow.status, keyRow.expiresAt, now);
  if (effectiveStatus !== "active") {
    throw genericAuthError;
  }

  // 5. Enforce required scope
  const scopesList = keyRow.scopes.split(",").map((s) => s.trim());
  if (!scopesList.includes(requiredScope)) {
    throw genericAuthError;
  }

  // 6. Throttled last_used_at update (write at most once every 5 minutes)
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const shouldUpdateLastUsed =
    !keyRow.lastUsedAt || now.getTime() - keyRow.lastUsedAt.getTime() >= FIVE_MINUTES_MS;

  if (shouldUpdateLastUsed) {
    try {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.id, keyRow.id));
    } catch {
      // Non-blocking for verification
    }
  }

  return {
    apiKeyId: keyRow.id,
    organizationId: keyRow.organizationId,
    scopes: scopesList,
  };
}
