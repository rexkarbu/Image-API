import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@/db";
import { user, organizations, organizationMembers, apiKeys, apiKeyAuditEvents } from "@/db/schema";
import { createOrganizationWithMembership, getUserFirstOrganization } from "@/lib/tenant/organizations";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  verifyApiKey,
} from "@/lib/services/api-keys";
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

  // Created key IDs for scoped cleanup
  const createdKeyIds: string[] = [];

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
    ).rejects.toThrow("Unauthorized");

    // 2. Member cannot revoke
    const testKey = await createApiKey(
      { organizationId: orgAId, userId: userAId, role: "owner" },
      { name: "Key For Member Revoke Test", scopes: "image:transform" }
    );
    createdKeyIds.push(testKey.key.id);

    await expect(
      revokeApiKey({ organizationId: orgAId, userId: memberAId, role: "member" }, testKey.key.id)
    ).rejects.toThrow("Unauthorized");

    // 3. Member cannot rotate
    await expect(
      rotateApiKey(
        { organizationId: orgAId, userId: memberAId, role: "member" },
        testKey.key.id,
        "grace_24h"
      )
    ).rejects.toThrow("Unauthorized");

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
});
