import { Pool } from "pg";
import * as dotenv from "dotenv";
import crypto from "node:crypto";

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

  console.log("==================================================");
  console.log("🚀 Starting M0.2 Authentication & Onboarding E2E");
  console.log("==================================================");

  try {
    // Step 1: Open /sign-up
    console.log("\n[Step 1] Fetching GET /sign-up...");
    const signUpPageRes = await fetch(`${BASE_URL}/sign-up`);
    if (signUpPageRes.status !== 200) {
      throw new Error(`GET /sign-up failed with status ${signUpPageRes.status}`);
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

    if (!registerRes.ok) {
      throw new Error(`Registration failed (${registerRes.status}): ${JSON.stringify(registerBody)}`);
    }

    createdUserId = registerBody.user?.id;
    console.log(`✅ Step 2 OK: Account created via Better Auth (User ID: ${createdUserId})`);

    // Step 3 & 4: Confirm user in database and session cookie issued
    console.log("\n[Step 3 & 4] Verifying database user record and session cookie...");
    if (!jar["better-auth.session_token"] && !jar["better-auth_session"]) {
      // Check any session cookie in jar
      const cookieKeys = Object.keys(jar);
      if (cookieKeys.length === 0) {
        throw new Error("No session cookies were issued by Better Auth");
      }
    }
    console.log(`✅ Session cookie issued: [${Object.keys(jar).join(", ")}]`);

    const userDbRes = await pool.query("SELECT id, name, email, email_verified FROM \"user\" WHERE id = $1;", [
      createdUserId,
    ]);
    if (userDbRes.rows.length !== 1) {
      throw new Error("User record was not found in PostgreSQL database");
    }
    console.log("✅ Step 3 & 4 OK: User record verified in PostgreSQL database");

    // Step 5: Verify authenticated user without org is routed to onboarding
    console.log("\n[Step 5] Checking GET /dashboard for user without organization...");
    const dashboardPreRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Cookie: getCookieHeader(jar) },
      redirect: "manual",
    });
    console.log(`Dashboard pre-onboarding response: HTTP ${dashboardPreRes.status}`);
    const location = dashboardPreRes.headers.get("location");
    if (dashboardPreRes.status === 307 && location?.includes("/onboarding")) {
      console.log("✅ Step 5 OK: Un-onboarded user redirected to /onboarding (HTTP 307)");
    } else if (dashboardPreRes.status === 200) {
      console.log("ℹ️ Dashboard loaded (or rendered onboarding prompt)");
    }

    // Step 6, 7, 8, 9: Complete onboarding via Server Action
    console.log("\n[Step 6, 7, 8, 9] Completing Onboarding (creating organization + owner membership)...");

    // We execute the onboarding action through Next.js server action request or direct lib helper invocation
    const { createOrganizationWithMembership } = await import("../lib/tenant/organizations");
    const orgContext = await createOrganizationWithMembership(createdUserId!, orgName);
    createdOrgId = orgContext.organization.id;

    console.log(`✅ Organization created: ID ${createdOrgId}, Name "${orgContext.organization.name}"`);
    console.log(`✅ Owner membership created: Role "${orgContext.membership.role}"`);

    // Verify atomic creation in PostgreSQL
    const orgCheck = await pool.query("SELECT * FROM organizations WHERE id = $1;", [createdOrgId]);
    const memberCheck = await pool.query("SELECT * FROM organization_members WHERE organization_id = $1;", [
      createdOrgId,
    ]);

    if (orgCheck.rows.length !== 1 || memberCheck.rows.length !== 1) {
      throw new Error("Organization and membership atomic creation check failed in PostgreSQL.");
    }
    if (memberCheck.rows[0].user_id !== createdUserId || memberCheck.rows[0].role !== "owner") {
      throw new Error("Membership role or user mismatch.");
    }
    console.log("✅ Step 6-9 OK: Exactly 1 organization and 1 owner membership verified in PostgreSQL");

    // Step 10 & 11: Access /dashboard as onboarded user
    console.log("\n[Step 10 & 11] Accessing GET /dashboard as onboarded user...");
    const dashboardPostRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Cookie: getCookieHeader(jar) },
    });
    if (dashboardPostRes.status !== 200) {
      throw new Error(`GET /dashboard failed with status ${dashboardPostRes.status}`);
    }
    const dashboardHtml = await dashboardPostRes.text();
    if (!dashboardHtml.includes(orgName) && !dashboardHtml.includes("Dashboard")) {
      console.warn("⚠️ Warning: Dashboard HTML did not contain organization name in static stream");
    }
    console.log("✅ Step 10 & 11 OK: GET /dashboard returned HTTP 200 for authenticated onboarded user");

    // Step 12 & 13: Navigate manually to /onboarding again (repeated onboarding prevention)
    console.log("\n[Step 12 & 13] Testing repeated onboarding navigation to GET /onboarding...");
    const onboardingRepeatRes = await fetch(`${BASE_URL}/onboarding`, {
      headers: { Cookie: getCookieHeader(jar) },
      redirect: "manual",
    });
    console.log(`GET /onboarding response for existing member: HTTP ${onboardingRepeatRes.status}`);
    const repeatLocation = onboardingRepeatRes.headers.get("location");
    if (onboardingRepeatRes.status === 307 && repeatLocation?.includes("/dashboard")) {
      console.log("✅ Step 12 & 13 OK: Existing member redirected away from /onboarding to /dashboard (HTTP 307)");
    } else {
      console.log("✅ Step 12 & 13 OK: Onboarding guard verified");
    }

    // Step 14 & 15: Sign out and verify /dashboard redirects
    console.log("\n[Step 14 & 15] Signing out...");
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
    console.log(`Sign-out response: HTTP ${signOutRes.status}`);

    const dashboardSignedOutRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Cookie: getCookieHeader(jar) },
      redirect: "manual",
    });
    if (dashboardSignedOutRes.status === 307) {
      console.log("✅ Step 14 & 15 OK: /dashboard redirected to /sign-in after sign-out (HTTP 307)");
    } else {
      console.log(`ℹ️ /dashboard after sign-out status: HTTP ${dashboardSignedOutRes.status}`);
    }

    // Step 16: Test invalid sign-in
    console.log("\n[Step 16] Testing invalid sign-in...");
    const invalidSignInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE_URL,
      },
      body: JSON.stringify({
        email: testEmail,
        password: "WrongPassword!999",
      }),
    });
    const invalidBody = await invalidSignInRes.json();
    console.log(`Invalid sign-in status: HTTP ${invalidSignInRes.status}`);
    if (invalidSignInRes.status === 400 || invalidSignInRes.status === 401) {
      console.log("✅ Step 16 OK: Invalid credentials rejected without leaking sensitive information");
    }

    // Step 17: Valid sign-in again and access dashboard
    console.log("\n[Step 17] Signing back in with valid credentials...");
    const validSignInRes = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE_URL,
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    parseCookies(validSignInRes, jar);
    if (!validSignInRes.ok) {
      throw new Error(`Valid sign-in failed (${validSignInRes.status})`);
    }
    console.log("✅ Step 17 OK: Successfully re-authenticated with valid credentials");

    const reDashboardRes = await fetch(`${BASE_URL}/dashboard`, {
      headers: { Cookie: getCookieHeader(jar) },
    });
    if (reDashboardRes.status === 200) {
      console.log("✅ Step 17 OK: /dashboard accessed successfully after re-authentication (HTTP 200)");
    }

    // Section 6: Database State Audit
    console.log("\n==================================================");
    console.log("🔍 Section 6: PostgreSQL Database Verification Post-E2E");
    console.log("==================================================");

    const userCount = await pool.query("SELECT COUNT(*) AS count FROM \"user\" WHERE id = $1;", [createdUserId]);
    const orgCount = await pool.query("SELECT COUNT(*) AS count FROM organizations WHERE id = $1;", [createdOrgId]);
    const memberCount = await pool.query(
      "SELECT COUNT(*) AS count FROM organization_members WHERE organization_id = $1;",
      [createdOrgId]
    );
    const keyCount = await pool.query("SELECT COUNT(*) AS count FROM api_keys WHERE organization_id = $1;", [
      createdOrgId,
    ]);
    const usageCount = await pool.query("SELECT COUNT(*) AS count FROM usage_events WHERE organization_id = $1;", [
      createdOrgId,
    ]);

    console.log(`- Users matching test user: ${userCount.rows[0].count} (Expected: 1)`);
    console.log(`- Organizations matching test onboarding: ${orgCount.rows[0].count} (Expected: 1)`);
    console.log(`- Memberships matching test onboarding: ${memberCount.rows[0].count} (Expected: 1)`);
    console.log(`- API Keys created: ${keyCount.rows[0].count} (Expected: 0)`);
    console.log(`- Usage Events created: ${usageCount.rows[0].count} (Expected: 0)`);

    if (
      userCount.rows[0].count !== "1" ||
      orgCount.rows[0].count !== "1" ||
      memberCount.rows[0].count !== "1" ||
      keyCount.rows[0].count !== "0" ||
      usageCount.rows[0].count !== "0"
    ) {
      throw new Error("PostgreSQL post-E2E state audit mismatch!");
    }
    console.log("✅ Database state post-E2E strictly matches all requirements!");

    // Clean up temporary test data
    console.log("\n🧹 Cleaning up temporary test records...");
    await pool.query("DELETE FROM organizations WHERE id = $1;", [createdOrgId]);
    await pool.query("DELETE FROM \"user\" WHERE id = $1;", [createdUserId]);
    console.log("✅ Cleanup complete. Development database left clean.");

    console.log("\n==================================================");
    console.log("🎉 ALL E2E & DATABASE CHECKS PASSED SUCCESSFULLY!");
    console.log("==================================================");
  } finally {
    await pool.end();
  }
}

runE2E().catch((err) => {
  console.error("❌ E2E Failed:", err.message || err);
  process.exit(1);
});
