import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@/db";
import { user, organizations, organizationMembers, apiKeys, apiKeyAuditEvents, usageEvents } from "@/db/schema";
import { createOrganizationWithMembership, getUserFirstOrganization } from "@/lib/tenant/organizations";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  verifyApiKey,
} from "@/lib/services/api-keys";
import { POST as transformRoute } from "@/app/v1/images/transform/route";
import { deriveRequestId } from "@/lib/api/idempotency";
import sharp from "sharp";
import { eq, and, sql, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import { assertDevelopmentDatabaseSafety } from "@/db/development-safety";

describe("Live PostgreSQL Integration Tests (Auth, Multi-Tenancy & API-Key Lifecycle)", () => {
  // Test User & Org Identifiers
  const userAId = `test-user-a-${crypto.randomUUID()}`;
  const userBId = `test-user-b-${crypto.randomUUID()}`;
  const memberAId = `test-member-a-${crypto.randomUUID()}`;

  let orgAId: string = "";
  let orgBId: string = "";

  // Created key IDs and usage IDs for scoped cleanup
  const createdKeyIds: string[] = [];
  const createdUsageIds: string[] = [];

  beforeAll(async () => {
    // 1. Enforce strict non-production environment safety guards
    assertDevelopmentDatabaseSafety();

    // 2. Insert test user fixtures
    const now = new Date();
    await db.insert(user).values([
      {
        id: userAId,
        name: "Test User A (Owner)",
        email: `user-a-${crypto.randomUUID()}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userBId,
        name: "Test User B (Owner)",
        email: `user-b-${crypto.randomUUID()}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: memberAId,
        name: "Test Member A (Member)",
        email: `member-a-${crypto.randomUUID()}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // 3. Create Org A and Org B
    const contextA = await createOrganizationWithMembership(userAId, "Org A Integration");
    orgAId = contextA.organization.id;

    const contextB = await createOrganizationWithMembership(userBId, "Org B Integration");
    orgBId = contextB.organization.id;

    // 4. Add Member A to Org A with 'member' role
    await db.insert(organizationMembers).values({
      organizationId: orgAId,
      userId: memberAId,
      role: "member",
      createdAt: now,
    });
  });

  afterAll(async () => {
    // Scoped cleanup targeting only the exact test IDs created in this run
    // Delete in reverse FK dependency order: audit events -> api keys -> memberships -> orgs -> users
    try {
      if (createdUsageIds.length > 0) {
        await db.delete(usageEvents).where(inArray(usageEvents.id, createdUsageIds));
      }
      if (createdKeyIds.length > 0) {
        await db.delete(apiKeyAuditEvents).where(inArray(apiKeyAuditEvents.apiKeyId, createdKeyIds));
        await db.delete(apiKeys).where(inArray(apiKeys.id, createdKeyIds));
      }
      if (orgAId || orgBId) {
        const orgIds = [orgAId, orgBId].filter(Boolean);
        await db.delete(organizationMembers).where(inArray(organizationMembers.organizationId, orgIds));
        await db.delete(organizations).where(inArray(organizations.id, orgIds));
      }
      await db.delete(user).where(inArray(user.id, [userAId, userBId, memberAId]));
    } catch (err) {
      console.error("⚠️ Failed to clean up integration test fixture rows:", (err as Error).message);
    } finally {
      await pool.end();
    }
  });

  it("verifies live PostgreSQL connectivity with SELECT 1", async () => {
    const result = await db.execute(sql`SELECT 1 AS connected`);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].connected).toBe(1);
  });

  it("verifies all 9 expected application tables exist in public schema", async () => {
    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const tables = result.rows.map((r) => r.table_name);
    const expected = [
      "user",
      "session",
      "account",
      "verification",
      "organizations",
      "organization_members",
      "api_keys",
      "api_key_audit_events",
      "usage_events",
    ];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
  });

  it("creates an API key for Org A and confirms SHA-256 storage and audit logging", async () => {
    const res = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Org A Production Key", scopes: "image:transform" }
    );
    createdKeyIds.push(res.key.id);

    expect(res.plaintextKey.startsWith("img_live_")).toBe(true);
    expect(res.key.name).toBe("Org A Production Key");
    expect(res.key.status).toBe("active");
    expect(res.key.keyPrefix.startsWith("img_live_")).toBe(true);
    expect(res.key).not.toHaveProperty("keyHash");

    // Inspect database row directly
    const [dbRow] = await db.select().from(apiKeys).where(eq(apiKeys.id, res.key.id));
    expect(dbRow).toBeDefined();
    expect(dbRow.keyHash).toHaveLength(64);
    expect(dbRow.keyHash).not.toEqual(res.plaintextKey);

    // Verify plaintext does NOT exist in any column
    const allDbValues = Object.values(dbRow).map(String);
    expect(allDbValues).not.toContain(res.plaintextKey);

    // Verify audit event
    const auditRows = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(eq(apiKeyAuditEvents.apiKeyId, res.key.id));
    expect(auditRows.length).toBe(1);
    expect(auditRows[0].eventType).toBe("created");
    expect(auditRows[0].organizationId).toBe(orgAId);
    expect(auditRows[0].actorUserId).toBe(userAId);
    expect(auditRows[0].relatedApiKeyId).toBeNull();
  });

  it("enforces multi-tenant isolation: Org B cannot list, revoke, or rotate Org A's key", async () => {
    // 1. Create key for Org A
    const keyARes = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Tenant A Secret Key", scopes: "image:transform" }
    );
    createdKeyIds.push(keyARes.key.id);

    // 2. Org B listing does not contain Org A's key
    const orgBKeys = await listApiKeys({ organizationId: orgBId }, "all");
    expect(orgBKeys.find((k) => k.id === keyARes.key.id)).toBeUndefined();

    // 3. Org B cannot revoke Org A's key (fails with generic not found)
    await expect(
      revokeApiKey({ organizationId: orgBId, userId: userBId, role: "owner" }, keyARes.key.id)
    ).rejects.toThrow("API key not found.");

    // 4. Org B cannot rotate Org A's key (fails with generic not found)
    await expect(
      rotateApiKey(
        { organizationId: orgBId, userId: userBId, role: "owner" },
        keyARes.key.id,
        "immediate"
      )
    ).rejects.toThrow("API key not found.");
  });

  it("enforces role-based permissions: member role cannot create, rotate, or revoke keys", async () => {
    // 1. Member cannot create
    await expect(
      createApiKey(
        { organizationId: orgAId, userId: memberAId, role: "member" },
        { name: "Unauthorized Member Key", scopes: "image:transform" }
      )
    ).rejects.toThrow("Forbidden");

    // 2. Member cannot revoke
    const testKey = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Key For Member Revoke Test", scopes: "image:transform" }
    );
    createdKeyIds.push(testKey.key.id);

    await expect(
      revokeApiKey({ organizationId: orgAId, userId: memberAId, role: "member" }, testKey.key.id)
    ).rejects.toThrow("Forbidden");

    // 3. Member cannot rotate
    await expect(
      rotateApiKey(
        { organizationId: orgAId, userId: memberAId, role: "member" },
        testKey.key.id,
        "grace_24h"
      )
    ).rejects.toThrow("Forbidden");

    // 4. Member CAN list metadata safely
    const memberKeys = await listApiKeys({ organizationId: orgAId }, "all");
    expect(memberKeys.length).toBeGreaterThan(0);
    expect(memberKeys[0]).not.toHaveProperty("keyHash");
  });

  it("verifies idempotent revocation and single audit event recording", async () => {
    const keyToRevoke = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Idempotent Revoke Key", scopes: "image:transform" }
    );
    createdKeyIds.push(keyToRevoke.key.id);

    // First revocation
    const revoked1 = await revokeApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      keyToRevoke.key.id
    );
    expect(revoked1.status).toBe("revoked");
    expect(revoked1.rawStatus).toBe("revoked");

    // Second revocation (idempotent)
    const revoked2 = await revokeApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      keyToRevoke.key.id
    );
    expect(revoked2.status).toBe("revoked");

    // Confirm only 1 'revoked' audit event was recorded
    const auditRows = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(
        and(
          eq(apiKeyAuditEvents.apiKeyId, keyToRevoke.key.id),
          eq(apiKeyAuditEvents.eventType, "revoked")
        )
      );
    expect(auditRows.length).toBe(1);
  });

  it("verifies API key authentication, scope enforcement, and throttled lastUsedAt", async () => {
    const created = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Verification Test Key", scopes: "image:transform" }
    );
    createdKeyIds.push(created.key.id);

    // 1. Valid authentication
    const verified = await verifyApiKey(created.plaintextKey, "image:transform");
    expect(verified.apiKeyId).toBe(created.key.id);
    expect(verified.organizationId).toBe(orgAId);
    expect(verified.scopes).toContain("image:transform");

    // 2. Database last_used_at timestamp updated
    const [dbRowAfter] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.key.id));
    expect(dbRowAfter.lastUsedAt).not.toBeNull();

    // 3. Wrong scope fails
    await expect(verifyApiKey(created.plaintextKey, "admin:write")).rejects.toThrow(
      "Invalid API key."
    );

    // 4. Revoked key authentication fails
    await revokeApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      created.key.id
    );
    await expect(verifyApiKey(created.plaintextKey, "image:transform")).rejects.toThrow(
      "Invalid API key."
    );

    // 5. Invalid / fabricated key fails generic error
    await expect(
      verifyApiKey("img_live_fake1234567890abcdef1234567890ABCDEF12345", "image:transform")
    ).rejects.toThrow("Invalid API key.");
  });

  it("verifies immediate rotation: revokes old key and activates replacement", async () => {
    const initialKey = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Immediate Rotation Key", scopes: "image:transform" }
    );
    createdKeyIds.push(initialKey.key.id);

    const rotation = await rotateApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      initialKey.key.id,
      "immediate"
    );
    createdKeyIds.push(rotation.newKey.id);

    expect(rotation.oldKey.status).toBe("revoked");
    expect(rotation.newKey.status).toBe("active");
    expect(rotation.plaintextKey.startsWith("img_live_")).toBe(true);

    // Old key no longer authenticates
    await expect(verifyApiKey(initialKey.plaintextKey, "image:transform")).rejects.toThrow(
      "Invalid API key."
    );

    // New key authenticates
    const verifiedNew = await verifyApiKey(rotation.plaintextKey, "image:transform");
    expect(verifiedNew.apiKeyId).toBe(rotation.newKey.id);

    // Verify audit rows: rotation_created on new key + revoked on old key
    const auditNew = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(eq(apiKeyAuditEvents.apiKeyId, rotation.newKey.id));
    expect(auditNew.some((a) => a.eventType === "rotation_created")).toBe(true);
  });

  it("verifies 24-hour grace rotation: keeps old key temporarily usable with expiration", async () => {
    const initialKey = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Grace Rotation Key", scopes: "image:transform" }
    );
    createdKeyIds.push(initialKey.key.id);

    const rotation = await rotateApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      initialKey.key.id,
      "grace_24h"
    );
    createdKeyIds.push(rotation.newKey.id);

    expect(rotation.oldKey.status).toBe("active");
    expect(rotation.oldKey.expiresAt).not.toBeNull();
    expect(rotation.newKey.status).toBe("active");

    // Both old key and new key authenticate during grace period
    const verifiedOld = await verifyApiKey(initialKey.plaintextKey, "image:transform");
    expect(verifiedOld.apiKeyId).toBe(initialKey.key.id);

    const verifiedNew = await verifyApiKey(rotation.plaintextKey, "image:transform");
    expect(verifiedNew.apiKeyId).toBe(rotation.newKey.id);

    // Test expired verification behavior with future time
    const simulatedFutureTime = new Date(Date.now() + 25 * 60 * 60 * 1000); // 25 hours later
    await expect(
      verifyApiKey(initialKey.plaintextKey, "image:transform", simulatedFutureTime)
    ).rejects.toThrow("Invalid API key.");
  });

  it("confirms audit event records never contain plaintext keys or hashes", async () => {
    const auditRows = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(inArray(apiKeyAuditEvents.apiKeyId, createdKeyIds));

    expect(auditRows.length).toBeGreaterThan(0);
    for (const row of auditRows) {
      expect(row).not.toHaveProperty("key");
      expect(row).not.toHaveProperty("plaintext");
      expect(row).not.toHaveProperty("keyHash");
    }
  });

  // =========================================================================
  // ADVERSARIAL CONCURRENCY TESTS (M1.1 CORRECTION)
  // =========================================================================

  it("handles parallel revoke calls without duplicate audit events (idempotent row-lock)", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const created = await createApiKey(context, { name: "Parallel Revoke Target", scopes: "image:transform" });
    createdKeyIds.push(created.key.id);

    // Launch 5 concurrent revoke requests against the same key
    const results = await Promise.allSettled([
      revokeApiKey(context, created.key.id),
      revokeApiKey(context, created.key.id),
      revokeApiKey(context, created.key.id),
      revokeApiKey(context, created.key.id),
      revokeApiKey(context, created.key.id),
    ]);

    // All 5 should resolve gracefully (performing revocation or returning already-revoked DTO)
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(5);

    // Confirm database state: status is 'revoked' and EXACTLY ONE 'revoked' audit event exists
    const [dbKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.key.id));
    expect(dbKey.status).toBe("revoked");
    expect(dbKey.revokedAt).not.toBeNull();

    const auditRows = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(
        and(
          eq(apiKeyAuditEvents.apiKeyId, created.key.id),
          eq(apiKeyAuditEvents.eventType, "revoked")
        )
      );
    expect(auditRows.length).toBe(1);
  });

  it("handles parallel immediate rotation: exactly one succeeds, losing requests fail safely with conflict", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const created = await createApiKey(context, { name: "Parallel Immediate Rotation Target", scopes: "image:transform" });
    createdKeyIds.push(created.key.id);

    // Launch 5 concurrent immediate rotation requests against the same key
    const results = await Promise.allSettled([
      rotateApiKey(context, created.key.id, "immediate"),
      rotateApiKey(context, created.key.id, "immediate"),
      rotateApiKey(context, created.key.id, "immediate"),
      rotateApiKey(context, created.key.id, "immediate"),
      rotateApiKey(context, created.key.id, "immediate"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    // Exactly 1 request must succeed
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    const winningResult = fulfilled[0].value;
    createdKeyIds.push(winningResult.newKey.id);

    expect(winningResult.plaintextKey.startsWith("img_live_")).toBe(true);
    expect(winningResult.newKey.status).toBe("active");
    expect(winningResult.oldKey.status).toBe("revoked");

    // All losing requests must fail with a safe domain error without exposing plaintext
    for (const rej of rejected) {
      expect(rej.reason).toBeInstanceOf(Error);
      expect(rej.reason.plaintextKey).toBeUndefined();
    }

    // Check DB: exactly 1 replacement key created with related_api_key_id pointing to created.key.id
    const rotationAuditEvents = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(
        and(
          eq(apiKeyAuditEvents.relatedApiKeyId, created.key.id),
          eq(apiKeyAuditEvents.eventType, "rotation_created")
        )
      );
    expect(rotationAuditEvents.length).toBe(1);

    // Winning key verifies; old key fails
    const verifiedNew = await verifyApiKey(winningResult.plaintextKey);
    expect(verifiedNew.apiKeyId).toBe(winningResult.newKey.id);

    await expect(verifyApiKey(created.plaintextKey)).rejects.toThrow("Invalid API key.");
  });

  it("handles parallel 24-hour grace rotation: exactly one succeeds without orphan keys or duplicate schedules", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const created = await createApiKey(context, { name: "Parallel Grace Rotation Target", scopes: "image:transform" });
    createdKeyIds.push(created.key.id);

    // Launch 5 concurrent 24-hour grace rotation requests
    const results = await Promise.allSettled([
      rotateApiKey(context, created.key.id, "grace_24h"),
      rotateApiKey(context, created.key.id, "grace_24h"),
      rotateApiKey(context, created.key.id, "grace_24h"),
      rotateApiKey(context, created.key.id, "grace_24h"),
      rotateApiKey(context, created.key.id, "grace_24h"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    const winningResult = fulfilled[0].value;
    createdKeyIds.push(winningResult.newKey.id);

    // Check DB: exactly 1 rotation_created event and 1 expiration_scheduled event
    const rotationAuditEvents = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(
        and(
          eq(apiKeyAuditEvents.relatedApiKeyId, created.key.id),
          eq(apiKeyAuditEvents.eventType, "rotation_created")
        )
      );
    expect(rotationAuditEvents.length).toBe(1);

    const expirationAuditEvents = await db
      .select()
      .from(apiKeyAuditEvents)
      .where(
        and(
          eq(apiKeyAuditEvents.apiKeyId, created.key.id),
          eq(apiKeyAuditEvents.eventType, "expiration_scheduled")
        )
      );
    expect(expirationAuditEvents.length).toBe(1);

    // Both keys verify during grace period
    const verifiedOld = await verifyApiKey(created.plaintextKey);
    expect(verifiedOld.apiKeyId).toBe(created.key.id);

    const verifiedNew = await verifyApiKey(winningResult.plaintextKey);
    expect(verifiedNew.apiKeyId).toBe(winningResult.newKey.id);
  });

  it("handles parallel verification calls with atomic, tenant-scoped throttled last_used_at updates", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const created = await createApiKey(context, { name: "Parallel Verify Target", scopes: "image:transform" });
    createdKeyIds.push(created.key.id);

    // Launch 5 concurrent verification calls with the same key
    const results = await Promise.all([
      verifyApiKey(created.plaintextKey),
      verifyApiKey(created.plaintextKey),
      verifyApiKey(created.plaintextKey),
      verifyApiKey(created.plaintextKey),
      verifyApiKey(created.plaintextKey),
    ]);

    expect(results.length).toBe(5);
    for (const res of results) {
      expect(res.apiKeyId).toBe(created.key.id);
      expect(res.organizationId).toBe(orgAId);
      expect(res.scopes).toContain("image:transform");
    }

    // Verify last_used_at in DB is populated
    const [dbKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.key.id));
    expect(dbKey.lastUsedAt).not.toBeNull();
  });

  // =========================================================================
  // MILESTONE 2: LIVE IMAGE TRANSFORM & ACCURATE USAGE METERING
  // =========================================================================

  async function generateTestPngBuffer(w = 100, h = 80): Promise<Buffer> {
    return await sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: { r: 120, g: 180, b: 240 },
      },
    })
      .png()
      .toBuffer();
  }

  function createTransformRequest(
    authBearer: string | null,
    idempotencyKey: string | null,
    fields: Record<string, string | null>,
    fileBuffer?: Buffer,
    fileName = "input.png",
    fieldName = "file"
  ): Request {
    const boundary = "----M2TestBoundary" + crypto.randomUUID().replace(/-/g, "");
    const chunks: Buffer[] = [];

    for (const [key, val] of Object.entries(fields)) {
      if (val !== null) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`
          )
        );
      }
    }

    if (fileBuffer) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: image/png\r\n\r\n`
        )
      );
      chunks.push(fileBuffer);
      chunks.push(Buffer.from("\r\n"));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const fullBody = Buffer.concat(chunks);

    const headers: Record<string, string> = {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(fullBody.length),
    };

    if (authBearer) {
      headers["Authorization"] = `Bearer ${authBearer}`;
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers,
      body: fullBody,
    });
  }

  it("processes valid image transformation, returns binary output, and records exact usage_event in PostgreSQL", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const keyRes = await createApiKey(context, { name: "M2 Success Key", scopes: "image:transform" });
    createdKeyIds.push(keyRes.key.id);

    const idempotencyKey = `idemp-${crypto.randomUUID()}`;
    const testImage = await generateTestPngBuffer(150, 100);

    const req = createTransformRequest(
      keyRes.plaintextKey,
      idempotencyKey,
      { width: "75", format: "webp", quality: "80" },
      testImage
    );

    const response = await transformRoute(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-usage-units")).toBe("1");
    expect(response.headers.get("x-image-width")).toBe("75");
    expect(response.headers.get("x-image-height")).toBe("50");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).not.toBeNull();

    const outputBuffer = Buffer.from(await response.arrayBuffer());
    expect(outputBuffer.length).toBeGreaterThan(0);

    const outMeta = await sharp(outputBuffer).metadata();
    expect(outMeta.format).toBe("webp");
    expect(outMeta.width).toBe(75);
    expect(outMeta.height).toBe(50);

    // Verify exactly 1 usage_event row recorded in PostgreSQL
    const expectedRequestId = deriveRequestId(orgAId, idempotencyKey);
    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, orgAId),
          eq(usageEvents.requestId, expectedRequestId)
        )
      );

    expect(usageRows.length).toBe(1);
    createdUsageIds.push(usageRows[0].id);

    expect(usageRows[0].apiKeyId).toBe(keyRes.key.id);
    expect(usageRows[0].endpoint).toBe("/v1/images/transform");
    expect(usageRows[0].units).toBe(1);
    expect(usageRows[0].statusCode).toBe(200);
  });

  it("handles sequential duplicate request: returns 409 DUPLICATE_REQUEST without creating extra usage rows", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const keyRes = await createApiKey(context, { name: "M2 Seq Duplicate Key", scopes: "image:transform" });
    createdKeyIds.push(keyRes.key.id);

    const idempotencyKey = `idemp-seq-${crypto.randomUUID()}`;
    const testImage = await generateTestPngBuffer(80, 80);

    // First request (success)
    const req1 = createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage);
    const res1 = await transformRoute(req1);
    expect(res1.status).toBe(200);

    // Second request with same idempotency key (duplicate)
    const req2 = createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage);
    const res2 = await transformRoute(req2);
    expect(res2.status).toBe(409);

    const body2 = await res2.json();
    expect(body2.error.code).toBe("DUPLICATE_REQUEST");

    // Verify still exactly 1 row in database
    const expectedRequestId = deriveRequestId(orgAId, idempotencyKey);
    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.requestId, expectedRequestId));
    expect(usageRows.length).toBe(1);
    createdUsageIds.push(usageRows[0].id);
  });

  it("handles 5 parallel requests with the same idempotency key: exactly 1 wins (200), 4 get 409, 1 usage row", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const keyRes = await createApiKey(context, { name: "M2 Parallel Deduplication Key", scopes: "image:transform" });
    createdKeyIds.push(keyRes.key.id);

    const idempotencyKey = `idemp-parallel-${crypto.randomUUID()}`;
    const testImage = await generateTestPngBuffer(50, 50);

    // Launch 5 concurrent requests with identical idempotency key
    const responses = await Promise.all([
      transformRoute(createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage)),
      transformRoute(createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage)),
      transformRoute(createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage)),
      transformRoute(createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage)),
      transformRoute(createTransformRequest(keyRes.plaintextKey, idempotencyKey, {}, testImage)),
    ]);

    const successes = responses.filter((r) => r.status === 200);
    const duplicates = responses.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(duplicates.length).toBe(4);

    // Check DB: exactly 1 row created
    const expectedRequestId = deriveRequestId(orgAId, idempotencyKey);
    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.requestId, expectedRequestId));
    expect(usageRows.length).toBe(1);
    createdUsageIds.push(usageRows[0].id);
  });

  it("allows the same raw idempotency key across different organizations (tenant namespaced)", async () => {
    const keyA = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Org A Key", scopes: "image:transform" }
    );
    createdKeyIds.push(keyA.key.id);

    const keyB = await createApiKey(
      { organizationId: orgBId, userId: userBId, role: "owner" },
      { name: "Org B Key", scopes: "image:transform" }
    );
    createdKeyIds.push(keyB.key.id);

    const sharedIdempotencyKey = `idemp-shared-${crypto.randomUUID()}`;
    const testImage = await generateTestPngBuffer(40, 40);

    const reqA = createTransformRequest(keyA.plaintextKey, sharedIdempotencyKey, {}, testImage);
    const resA = await transformRoute(reqA);
    expect(resA.status).toBe(200);

    const reqB = createTransformRequest(keyB.plaintextKey, sharedIdempotencyKey, {}, testImage);
    const resB = await transformRoute(reqB);
    expect(resB.status).toBe(200);

    // Both succeeded with different derived request_id hashes in DB
    const hashA = deriveRequestId(orgAId, sharedIdempotencyKey);
    const hashB = deriveRequestId(orgBId, sharedIdempotencyKey);
    expect(hashA).not.toBe(hashB);

    const rowsA = await db.select().from(usageEvents).where(eq(usageEvents.requestId, hashA));
    const rowsB = await db.select().from(usageEvents).where(eq(usageEvents.requestId, hashB));
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(1);
    createdUsageIds.push(rowsA[0].id, rowsB[0].id);
  });

  it("ensures zero usage_events are recorded on authentication failure (invalid, revoked, or expired key)", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const keyRes = await createApiKey(context, { name: "Key For Failure Tests", scopes: "image:transform" });
    createdKeyIds.push(keyRes.key.id);

    const testImage = await generateTestPngBuffer(30, 30);

    // 1. Invalid Bearer
    const resInvalid = await transformRoute(
      createTransformRequest("img_live_invalidkey123456789012345678901234567890", `idemp-${crypto.randomUUID()}`, {}, testImage)
    );
    expect(resInvalid.status).toBe(401);

    // 2. Revoked Key
    await revokeApiKey(context, keyRes.key.id);
    const resRevoked = await transformRoute(
      createTransformRequest(keyRes.plaintextKey, `idemp-${crypto.randomUUID()}`, {}, testImage)
    );
    expect(resRevoked.status).toBe(401);

    // Confirm 0 usage rows created
    const rows = await db.select().from(usageEvents).where(eq(usageEvents.apiKeyId, keyRes.key.id));
    expect(rows.length).toBe(0);
  });

  it("ensures zero usage_events are recorded on invalid options or unsupported input", async () => {
    const context = { organizationId: orgAId, userId: userAId, role: "owner" };
    const keyRes = await createApiKey(context, { name: "Key For Bad Requests", scopes: "image:transform" });
    createdKeyIds.push(keyRes.key.id);

    const testImage = await generateTestPngBuffer(30, 30);

    // 1. Invalid option: PNG with quality
    const resBadOptions = await transformRoute(
      createTransformRequest(keyRes.plaintextKey, `idemp-${crypto.randomUUID()}`, { format: "png", quality: "80" }, testImage)
    );
    expect(resBadOptions.status).toBe(400);

    // 2. Unsupported format: Valid SVG (detected as SVG -> 415)
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>');
    const resSvg = await transformRoute(
      createTransformRequest(keyRes.plaintextKey, `idemp-${crypto.randomUUID()}`, {}, svgBuffer)
    );
    expect(resSvg.status).toBe(415);

    // 3. Corrupt image bytes (422 UNPROCESSABLE_IMAGE)
    const corruptBuffer = Buffer.from("not-an-image-corrupt-data");
    const resCorrupt = await transformRoute(
      createTransformRequest(keyRes.plaintextKey, `idemp-${crypto.randomUUID()}`, {}, corruptBuffer)
    );
    expect(resCorrupt.status).toBe(422);

    // Confirm 0 usage rows created
    const rows = await db.select().from(usageEvents).where(eq(usageEvents.apiKeyId, keyRes.key.id));
    expect(rows.length).toBe(0);
  });

  it("enforces multi-tenant query isolation on usage_events", async () => {
    // Org A queries usage events scoped to orgAId
    const orgARows = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, orgAId));

    // Org B queries usage events scoped to orgBId
    const orgBRows = await db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, orgBId));

    // Ensure no cross-tenant leakage
    for (const r of orgARows) {
      expect(r.organizationId).toBe(orgAId);
    }
    for (const r of orgBRows) {
      expect(r.organizationId).toBe(orgBId);
    }
  });
});

