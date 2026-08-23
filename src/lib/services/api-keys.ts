import "server-only";

import { db } from "@/db";
import { apiKeys, apiKeyAuditEvents, user } from "@/db/schema";
import {
  generateFullApiKey,
  deriveApiKeyDisplayPrefix,
  deriveApiKeyStatus,
  canManageApiKeys,
  isValidApiKeyFormat,
  hashApiKey,
} from "@/lib/crypto/api-keys";
import {
  apiKeyNameSchema,
  CreateApiKeyInput,
  ApiKeyStatusFilter,
  ApiKeyRotationMode,
} from "@/lib/validations/api-keys";
import {
  ApiKeyDto,
  CreateApiKeyResult,
  RotateApiKeyResult,
  ApiKeyErrorCode,
} from "@/types/api-keys";
import { eq, and, sql, desc } from "drizzle-orm";
import crypto from "node:crypto";

export class ApiKeyServiceError extends Error {
  readonly code: ApiKeyErrorCode;

  constructor(code: ApiKeyErrorCode, message: string) {
    super(message);
    this.name = "ApiKeyServiceError";
    this.code = code;
  }
}

export interface VerifiedApiKeyIdentity {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
}

function toIsoString(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
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
    lastUsedAt: Date | string | null;
    expiresAt: Date | string | null;
    revokedAt: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
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
    lastUsedAt: toIsoString(row.lastUsedAt),
    expiresAt: toIsoString(row.expiresAt),
    revokedAt: toIsoString(row.revokedAt),
    createdAt: toIsoString(row.createdAt) || new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) || new Date().toISOString(),
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
    throw new ApiKeyServiceError(
      "FORBIDDEN",
      "Forbidden: You do not have permission to create API keys in this organization."
    );
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
        scopes: "image:transform",
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

  const statusRank: Record<string, number> = {
    active: 1,
    expired: 2,
    revoked: 3,
  };

  return filtered.sort((a, b) => {
    const rankDiff = (statusRank[a.status] || 99) - (statusRank[b.status] || 99);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Revokes an API key with concurrency safety.
 * Scoped strictly to the trusted organization ID.
 * Uses PostgreSQL row-locking to serialize concurrent requests.
 * Appends exactly one 'revoked' audit event on state transition.
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
    throw new ApiKeyServiceError(
      "FORBIDDEN",
      "Forbidden: You do not have permission to revoke API keys in this organization."
    );
  }

  const now = new Date();

  const updatedRow = await db.transaction(async (tx) => {
    // 1. Fetch key strictly within trusted organization with row lock
    const lockedRows = await tx.execute<{
      id: string;
      organization_id: string;
      name: string;
      key_prefix: string;
      scopes: string;
      status: string;
      last_used_at: Date | null;
      expires_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      sql`SELECT id, organization_id, name, key_prefix, scopes, status, last_used_at, expires_at, revoked_at, created_at, updated_at
          FROM api_keys
          WHERE id = ${keyId} AND organization_id = ${trustedContext.organizationId}
          FOR UPDATE`
    );

    const existing = lockedRows.rows[0];
    if (!existing) {
      throw new ApiKeyServiceError("NOT_FOUND_OR_UNAVAILABLE", "API key not found.");
    }

    // Idempotent: if already revoked, return existing without new audit event
    if (existing.status === "revoked") {
      return {
        id: existing.id,
        organizationId: existing.organization_id,
        name: existing.name,
        keyPrefix: existing.key_prefix,
        scopes: existing.scopes,
        status: existing.status,
        lastUsedAt: existing.last_used_at,
        expiresAt: existing.expires_at,
        revokedAt: existing.revoked_at,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      };
    }

    // 2. Perform revocation update
    const [updated] = await tx
      .update(apiKeys)
      .set({
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
      })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, trustedContext.organizationId)))
      .returning();

    // 3. Record audit event (guaranteed unique per key by partial unique index)
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
 * Rotates an active, usable API key with concurrency safety.
 * Uses a PostgreSQL row lock on the source key to prevent race conditions.
 * Ensures at most one direct replacement per key.
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
    throw new ApiKeyServiceError(
      "FORBIDDEN",
      "Forbidden: You do not have permission to rotate API keys in this organization."
    );
  }

  const now = new Date();
  const newKeyId = crypto.randomUUID();

  // Execute atomic rotation inside transaction with source row lock
  const result = await db.transaction(async (tx) => {
    // 1. Lock source row within organization
    const lockedRows = await tx.execute<{
      id: string;
      organization_id: string;
      name: string;
      key_prefix: string;
      scopes: string;
      status: string;
      last_used_at: Date | null;
      expires_at: Date | null;
      revoked_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      sql`SELECT id, organization_id, name, key_prefix, scopes, status, last_used_at, expires_at, revoked_at, created_at, updated_at
          FROM api_keys
          WHERE id = ${keyId} AND organization_id = ${trustedContext.organizationId}
          FOR UPDATE`
    );

    const oldKey = lockedRows.rows[0];
    if (!oldKey) {
      throw new ApiKeyServiceError("NOT_FOUND_OR_UNAVAILABLE", "API key not found.");
    }

    const currentStatus = deriveApiKeyStatus(oldKey.status, oldKey.expires_at, now);
    if (currentStatus !== "active") {
      throw new ApiKeyServiceError(
        "CONFLICT",
        `Cannot rotate an API key that is already ${currentStatus}.`
      );
    }

    // 2. Check if this key already produced a replacement
    const existingReplacements = await tx.execute<{ id: string }>(
      sql`SELECT id FROM api_key_audit_events
          WHERE related_api_key_id = ${keyId} AND event_type = 'rotation_created'
          LIMIT 1`
    );

    if (existingReplacements.rows.length > 0) {
      throw new ApiKeyServiceError("CONFLICT", "API key has already been rotated.");
    }

    // 3. Generate new key credentials only after lock & validation
    const { plaintextKey, keyPrefix, keyHash } = generateFullApiKey();

    // 4. Insert replacement key
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

    // 5. Record rotation_created audit event (enforced unique per related_api_key_id)
    await tx.insert(apiKeyAuditEvents).values({
      id: crypto.randomUUID(),
      organizationId: trustedContext.organizationId,
      apiKeyId: newKeyId,
      relatedApiKeyId: oldKey.id,
      actorUserId: trustedContext.userId,
      eventType: "rotation_created",
      createdAt: now,
    });

    let updatedOldKeyRow = {
      id: oldKey.id,
      organizationId: oldKey.organization_id,
      name: oldKey.name,
      keyPrefix: oldKey.key_prefix,
      scopes: oldKey.scopes,
      status: oldKey.status,
      lastUsedAt: oldKey.last_used_at,
      expiresAt: oldKey.expires_at,
      revokedAt: oldKey.revoked_at,
      createdAt: oldKey.created_at,
      updatedAt: oldKey.updated_at,
    };

    if (mode === "immediate") {
      // Immediate mode: revoke old key
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
        oldKey.expires_at && oldKey.expires_at.getTime() < graceExpiry.getTime()
          ? oldKey.expires_at
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
      plaintextKey,
    };
  });

  return {
    newKey: toApiKeyDto(result.newKeyRow),
    oldKey: toApiKeyDto(result.updatedOldKeyRow),
    plaintextKey: result.plaintextKey,
  };
}

/**
 * Server-only API key verification foundation.
 * Validates format, SHA-256 hash lookup, active status, and required scope.
 * Employs a generic error on any failure to avoid disclosing key existence or status.
 * Executes atomic, tenant-scoped throttled update of last_used_at.
 */
export async function verifyApiKey(
  rawKey: string,
  requiredScope: string = "image:transform",
  now: Date = new Date()
): Promise<VerifiedApiKeyIdentity> {
  const genericAuthError = new ApiKeyServiceError("UNAUTHORIZED", "Invalid API key.");

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

  // 6. Atomic, tenant-scoped throttled last_used_at update (at most once every 5 minutes)
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const cutoff = new Date(now.getTime() - FIVE_MINUTES_MS);

  try {
    await db.execute(sql`
      UPDATE api_keys
      SET last_used_at = ${now}
      WHERE id = ${keyRow.id}
        AND organization_id = ${keyRow.organizationId}
        AND (last_used_at IS NULL OR last_used_at <= ${cutoff})
    `);
  } catch {
    // Best-effort: timestamp update error must not fail a valid authentication
  }

  return {
    apiKeyId: keyRow.id,
    organizationId: keyRow.organizationId,
    scopes: scopesList,
  };
}
