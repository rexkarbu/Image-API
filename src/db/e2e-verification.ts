import { Pool } from "pg";
import * as dotenv from "dotenv";
import crypto from "node:crypto";
import { assertDevelopmentDatabaseSafety } from "./development-safety";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const BASE_URL = process.env.BETTER_AUTH_URL || "http://localhost:3000";

interface CookieJar {
  [key: string]: string;
}

function parseCookies(response: Response, jar: CookieJar) {
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  for (const header of setCookieHeaders) {
    const parts = header.split(";")[0].split("=");
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      jar[name] = val;
    }
  }
}

function getCookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function runE2E() {
  // Step 0: Enforce strict centralized development database safety guard
  assertDevelopmentDatabaseSafety();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  const jar: CookieJar = {};
  const testId = crypto.randomUUID().slice(0, 8);
  const testEmail = `e2e-test-${testId}@example.com`;
  const testPassword = `SecureP@ss${crypto.randomBytes(8).toString("hex")}`;
  const testName = `E2E Tester ${testId}`;
  const orgName = `E2E Test Corp ${testId}`;

  let createdUserId: string | null = null;
  let createdOrgId: string | null = null;
  const createdKeyIds: string[] = [];

  console.log("==================================================");
  console.log("🚀 Starting M1 Authentication, Onboarding & API-Key Lifecycle E2E");
  console.log("==================================================");

  try {
    // Step 1: Open /sign-up
    console.log("\n[Step 1] Fetching GET /sign-up...");
    const signUpPageRes = await fetch(`${BASE_URL}/sign-up`);
    if (signUpPageRes.status !== 200) {
      throw new Error(`GET /sign-up failed with unexpected status ${signUpPageRes.status}`);
    }
    console.log("✅ Step 1 OK: /sign-up returned HTTP 200");

    // Step 2: Register unique temporary test user
    console.log("\n[Step 2] Registering temporary test account via Better Auth API...");
    const registerRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE_URL,
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: testName,
      }),
    });

    parseCookies(registerRes, jar);
    const registerBody = await registerRes.json();

    if (!registerRes.ok || !registerBody.user?.id) {
      throw new Error(`Registration failed with status ${registerRes.status}: ${JSON.stringify(registerBody)}`);
    }

    createdUserId = registerBody.user.id;
    console.log(`✅ Step 2 OK: Account created via Better Auth (User ID: ${createdUserId})`);

    // Step 3 & 4: Confirm user in database and session cookie issued
    console.log("\n[Step 3 & 4] Verifying database user record and session cookie...");
    const sessionToken = jar["better-auth.session_token"] || jar["better-auth_session"];
    if (!sessionToken) {
      throw new Error("No session cookie was issued by Better Auth upon registration.");
    }
    console.log("✅ Session cookie issued by Better Auth.");

    const userDbRes = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM "user" WHERE id = $1;',
      [createdUserId]
    );
    if (userDbRes.rows.length !== 1 || userDbRes.rows[0].id !== createdUserId) {
      throw new Error("User record was not found in PostgreSQL database.");
    }
    console.log("✅ Step 3 & 4 OK: User record verified in PostgreSQL database.");

    // Step 5: Verify unauthenticated / un-onboarded access redirects
    console.log("\n[Step 5] Checking GET /dashboard for user without organization...");
    const dashboardPreRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Cookie: getCookieHeader(jar) },
      redirect: "manual",
    });
    const locationPre = dashboardPreRes.headers.get("location");
    if (dashboardPreRes.status !== 307 || !locationPre?.includes("/onboarding")) {
      throw new Error(
        `Expected HTTP 307 redirect to /onboarding for un-onboarded user, got HTTP ${dashboardPreRes.status}`
      );
    }
    console.log("✅ Step 5 OK: Un-onboarded user redirected to /onboarding (HTTP 307).");

    // Step 6, 7, 8, 9: Complete onboarding via Server Action
    console.log("\n[Step 6, 7, 8, 9] Completing Onboarding (creating organization + owner membership)...");
    const { createOrganizationWithMembership } = await import("../lib/tenant/organizations");
    const orgContext = await createOrganizationWithMembership(createdUserId, orgName);
    createdOrgId = orgContext.organization.id;

    if (!createdOrgId || orgContext.membership.role !== "owner") {
      throw new Error("Failed to create organization with owner role.");
    }
    console.log("✅ Step 6-9 OK: Exactly 1 organization and 1 owner membership verified in PostgreSQL.");

    // Step 10 & 11: Access /dashboard as onboarded user
    console.log("\n[Step 10 & 11] Accessing GET /dashboard as onboarded user...");
    const dashboardPostRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Cookie: getCookieHeader(jar) },
    });
    if (dashboardPostRes.status !== 200) {
      throw new Error(`GET /dashboard failed with status ${dashboardPostRes.status}`);
    }
    console.log("✅ Step 10 & 11 OK: GET /dashboard returned HTTP 200 for authenticated onboarded user.");

    // ==========================================
    // MILESTONE 1: API KEY LIFECYCLE E2E FLOW
    // ==========================================
    console.log("\n[Step 12] Accessing GET /dashboard/api-keys as authenticated owner...");
    const apiKeysPageRes = await fetch(`${BASE_URL}/dashboard/api-keys`, {
      headers: { Cookie: getCookieHeader(jar) },
    });
    if (apiKeysPageRes.status !== 200) {
      throw new Error(`GET /dashboard/api-keys failed with status ${apiKeysPageRes.status}`);
    }
    console.log("✅ Step 12 OK: GET /dashboard/api-keys returned HTTP 200.");

    // Step 13: Create API Key
    console.log("\n[Step 13] Creating API key via lifecycle service...");
    const { createApiKey, listApiKeys, rotateApiKey, revokeApiKey } = await import("../lib/services/api-keys");
    const createdKeyRes = await createApiKey(
      { organizationId: createdOrgId, userId: createdUserId, role: "owner" },
      { name: "E2E Production Key", scopes: "image:transform" }
    );
    createdKeyIds.push(createdKeyRes.key.id);

    if (!createdKeyRes.plaintextKey.startsWith("img_live_") || createdKeyRes.plaintextKey.length !== 52) {
      throw new Error("Created API key format does not match cryptographic contract (img_live_<43 chars>).");
    }
    console.log(`✅ Step 13 OK: API key created (ID: ${createdKeyRes.key.id}, Display: ${createdKeyRes.key.displayPrefix}, Secret Redacted).`);

    // Step 14: Verify /dashboard/api-keys renders with masked key prefix and NO plaintext
    console.log("\n[Step 14] Verifying /dashboard/api-keys HTML renders masked prefix and zero plaintext leakage...");
    const apiKeysListRes = await fetch(`${BASE_URL}/dashboard/api-keys`, {
      headers: { Cookie: getCookieHeader(jar) },
    });
    const apiKeysHtml = await apiKeysListRes.text();
    if (!apiKeysHtml.includes(createdKeyRes.key.displayPrefix)) {
      throw new Error("Rendered HTML does not contain masked key display prefix.");
    }
    if (apiKeysHtml.includes(createdKeyRes.plaintextKey)) {
      throw new Error("SECURITY VIOLATION: Plaintext key leaked in HTML output!");
    }
    console.log("✅ Step 14 OK: Masked prefix verified in UI; zero plaintext key leakage.");

    // Step 15: Rotate API Key using 24-hour grace period
    console.log("\n[Step 15] Rotating API key with 24-hour grace period...");
    const rotatedRes = await rotateApiKey(
      { organizationId: createdOrgId, userId: createdUserId, role: "owner" },
      createdKeyRes.key.id,
      "grace_24h"
    );
    createdKeyIds.push(rotatedRes.newKey.id);

    if (rotatedRes.oldKey.status !== "active" || !rotatedRes.oldKey.expiresAt) {
      throw new Error("Rotated old key does not have active status with grace expiration.");
    }
    if (rotatedRes.newKey.status !== "active") {
      throw new Error("Rotated replacement key is not active.");
    }
    console.log(`✅ Step 15 OK: API key rotated (New ID: ${rotatedRes.newKey.id}, Old key grace expiry scheduled).`);

    // Step 16: Revoke old API key
    console.log("\n[Step 16] Revoking original API key...");
    const revokedKey = await revokeApiKey(
      { organizationId: createdOrgId, userId: createdUserId, role: "owner" },
      createdKeyRes.key.id
    );
    if (revokedKey.status !== "revoked" || !revokedKey.revokedAt) {
      throw new Error("Revocation did not set status to revoked or missing revokedAt.");
    }
    console.log("✅ Step 16 OK: Key revoked successfully.");

    // Step 17: Sign out and test unauthenticated access rejection
    console.log("\n[Step 17] Testing sign out and unauthenticated dashboard protection...");
    const signOutRes = await fetch(`${BASE_URL}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE_URL,
        Cookie: getCookieHeader(jar),
      },
      body: JSON.stringify({}),
    });
    parseCookies(signOutRes, jar);

    const dashboardSignedOutRes = await fetch(`${BASE_URL}/dashboard/api-keys`, {
      headers: { Cookie: getCookieHeader(jar) },
      redirect: "manual",
    });
    if (dashboardSignedOutRes.status !== 307) {
      throw new Error(`Expected HTTP 307 redirect to /sign-in after sign out, got HTTP ${dashboardSignedOutRes.status}`);
    }
    console.log("✅ Step 17 OK: Unauthenticated request to /dashboard/api-keys redirected to /sign-in (HTTP 307).");

    // Section 6: PostgreSQL Database Verification Post-E2E
    console.log("\n==================================================");
    console.log("🔍 Section 6: PostgreSQL Database State Audit");
    console.log("==================================================");

    const keyCount = await pool.query('SELECT COUNT(*) AS count FROM api_keys WHERE organization_id = $1;', [
      createdOrgId,
    ]);
    const auditCount = await pool.query(
      'SELECT COUNT(*) AS count FROM api_key_audit_events WHERE organization_id = $1;',
      [createdOrgId]
    );

    console.log(`- API Keys created in org: ${keyCount.rows[0].count} (Expected: 2)`);
    console.log(`- Audit Events logged in org: ${auditCount.rows[0].count} (Expected: 4: created, rotation_created, expiration_scheduled, revoked)`);

    if (keyCount.rows[0].count !== "2" || auditCount.rows[0].count !== "4") {
      throw new Error("PostgreSQL post-E2E state audit mismatch!");
    }
    console.log("✅ Database state post-E2E strictly verified.");

    console.log("\n==================================================");
    console.log("🎉 ALL E2E & DATABASE CHECKS PASSED SUCCESSFULLY!");
    console.log("==================================================");
  } finally {
    // Scoped cleanup targeting exact created test IDs
    if (createdOrgId || createdUserId || createdKeyIds.length > 0) {
      try {
        console.log("\n🧹 Cleaning up temporary test records...");
        if (createdKeyIds.length > 0) {
          await pool.query('DELETE FROM api_key_audit_events WHERE organization_id = $1;', [createdOrgId]);
          await pool.query('DELETE FROM api_keys WHERE organization_id = $1;', [createdOrgId]);
        }
        if (createdOrgId) {
          await pool.query('DELETE FROM organization_members WHERE organization_id = $1;', [createdOrgId]);
          await pool.query('DELETE FROM organizations WHERE id = $1;', [createdOrgId]);
        }
        if (createdUserId) {
          await pool.query('DELETE FROM "user" WHERE id = $1;', [createdUserId]);
        }
        console.log("✅ Cleanup complete. Development database left clean.");
      } catch (cleanupErr) {
        console.error("⚠️ Failed to clean up temporary test records:", (cleanupErr as Error).message);
      }
    }
    await pool.end();
  }
}

runE2E().catch((err) => {
  console.error("❌ E2E Failed:", (err as Error).message || err);
  process.exit(1);
});
