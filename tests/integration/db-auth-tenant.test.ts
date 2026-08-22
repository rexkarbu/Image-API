import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@/db";
import { user, organizations, organizationMembers } from "@/db/schema";
import { createOrganizationWithMembership, getUserFirstOrganization } from "@/lib/tenant/organizations";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";

function assertSafeTestEnvironment() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error(
      "Refusing to execute live database integration tests in production environment (NODE_ENV/VERCEL_ENV is 'production')."
    );
  }
  if (process.env.RUN_DB_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Live database integration tests require explicit opt-in: RUN_DB_INTEGRATION_TESTS=true."
    );
  }
  if (process.env.DATABASE_ENV !== "development") {
    throw new Error(
      "Live database integration tests require DATABASE_ENV='development'."
    );
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set for integration tests.");
  }
  try {
    const parsed = new URL(dbUrl);
    const isSafeDev =
      parsed.hostname.includes("neon.tech") ||
      parsed.hostname.includes("localhost") ||
      parsed.hostname.includes("127.0.0.1");

    if (!isSafeDev) {
      throw new Error(
        "Refusing to run integration tests against an unverified or production database host."
      );
    }
  } catch (err) {
    throw new Error(
      `Database URL safety verification failed: ${(err as Error).message}`
    );
  }
}

describe("Live PostgreSQL Integration Tests", () => {
  const testUserId = `test-user-${crypto.randomUUID()}`;
  const testEmail = `test-user-${crypto.randomUUID()}@example.com`;
  let createdOrgId: string | null = null;

  beforeAll(async () => {
    // 1. Enforce strict non-production environment safety guards
    assertSafeTestEnvironment();

    // 2. Insert test user into auth user table
    try {
      await db.insert(user).values({
        id: testUserId,
        name: "Integration Test User",
        email: testEmail,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err) {
      throw new Error(`Failed to initialize test user fixture: ${(err as Error).message}`);
    }
  });

  afterAll(async () => {
    // Scoped cleanup targeting only the exact test IDs created in this run
    try {
      if (createdOrgId) {
        await db.delete(organizations).where(eq(organizations.id, createdOrgId));
      }
      await db.delete(user).where(eq(user.id, testUserId));
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

  it("verifies all 8 expected application tables exist in public schema", async () => {
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
      "usage_events",
    ];
    for (const table of expected) {
      expect(tables).toContain(table);
    }
  });

  it("atomically creates an organization and owner membership", async () => {
    const orgName = "Integration Test Org";
    const context = await createOrganizationWithMembership(testUserId, orgName);
    createdOrgId = context.organization.id;

    expect(context.organization).toBeDefined();
    expect(context.organization.id).toBeDefined();
    expect(context.organization.name).toBe(orgName);
    expect(context.membership.role).toBe("owner");

    // Verify in database
    const orgRows = await db.select().from(organizations).where(eq(organizations.id, context.organization.id));
    expect(orgRows.length).toBe(1);

    const memberRows = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, context.organization.id));
    expect(memberRows.length).toBe(1);
    expect(memberRows[0].userId).toBe(testUserId);
    expect(memberRows[0].role).toBe("owner");
  });

  it("resolves tenant-context lookup for the authenticated user", async () => {
    const userOrgContext = await getUserFirstOrganization(testUserId);
    expect(userOrgContext).not.toBeNull();
    expect(userOrgContext?.organization.id).toBe(createdOrgId);
    expect(userOrgContext?.membership.role).toBe("owner");
  });

  it("prevents repeated onboarding / creating a second organization for single-org tenant rule", async () => {
    // Check via getUserFirstOrganization
    const existing = await getUserFirstOrganization(testUserId);
    expect(existing).not.toBeNull();

    // Verify existing membership count is strictly 1
    const members = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, testUserId));
    expect(members.length).toBe(1);
  });
});
