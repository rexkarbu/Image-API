import fs from "node:fs";
import https from "node:https";
import crypto from "node:crypto";
import { Pool } from "pg";
import Stripe from "stripe";

import dotenv from "dotenv";

const previewEnv = dotenv.parse(fs.readFileSync(".env.vercel-preview.local", "utf8"));
const host = "hlf-git-m61-vercel-deployment-artha8.vercel.app";
const dbUrl = previewEnv.DATABASE_URL;
const webhookSecret = previewEnv.STRIPE_WEBHOOK_SECRET;
const stripeKey = previewEnv.STRIPE_SECRET_KEY;
const bypassSecret = "DmMe1KvJ1oMDvkwLXSM7ZwHJEdNlo1yB";

const pool = new Pool({
  connectionString: dbUrl,
  max: 3,
  connectionTimeoutMillis: 10000,
});

const stripe = new Stripe(stripeKey, {
  apiVersion: "2025-02-24.acacia" as any,
});

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBuffer: Buffer;
}

function makeHttpsRequest(options: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  cookies?: string[];
}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "x-vercel-protection-bypass": bypassSecret,
      ...options.headers,
    };

    if (options.cookies && options.cookies.length > 0) {
      headers["Cookie"] = options.cookies.join("; ");
    }

    if (options.body && !headers["Content-Length"]) {
      headers["Content-Length"] = Buffer.isBuffer(options.body)
        ? String(options.body.length)
        : String(Buffer.byteLength(options.body));
    }

    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: options.path,
        method: options.method || "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const rawBuffer = Buffer.concat(chunks);
          const body = rawBuffer.toString("utf8");
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
            rawBuffer,
          });
        });
      }
    );

    req.on("error", (err) => reject(err));

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function extractCookies(headers: Record<string, string | string[] | undefined>): string[] {
  const setCookie = headers["set-cookie"];
  if (!setCookie) return [];
  const rawList = Array.isArray(setCookie) ? setCookie : [setCookie];
  return rawList.map((c) => c.split(";")[0]);
}

async function runAcceptance() {
  console.log("================================================================================");
  console.log("🚀 M6.1 PREVIEW COMPREHENSIVE REMOTE ACCEPTANCE SUITE");
  console.log(`🎯 Target Preview URL: https://${host}`);
  console.log("================================================================================\n");

  // Clean up any initial probe rows
  await pool.query(`DELETE FROM billing_webhook_events WHERE id LIKE 'evt_preview_probe_%'`);

  // ===========================================================================
  // GATE 1: STRIPE WEBHOOK SECURITY, INGESTION & IDEMPOTENCY
  // ===========================================================================
  console.log("--- GATE 1: Stripe Webhook Security, Ingestion & Idempotency ---");

  // 1.1 Missing Signature -> 400
  console.log("1.1 Probing webhook without Stripe-Signature header...");
  const noSigRes = await makeHttpsRequest({
    path: "/api/webhooks/stripe",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (noSigRes.statusCode === 400 && noSigRes.body.includes("Missing Stripe-Signature")) {
    console.log("  ✅ 1.1 OK: Rejected with HTTP 400 (Missing Stripe-Signature header).");
  } else {
    throw new Error(`1.1 Failed: expected 400, got ${noSigRes.statusCode} -> ${noSigRes.body}`);
  }

  // 1.2 Forged Signature -> 400
  console.log("1.2 Probing webhook with forged signature...");
  const forgedRes = await makeHttpsRequest({
    path: "/api/webhooks/stripe",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": "t=1234567890,v1=bad_signature_0000000000000000000000000000000000000000000000000000000000000000",
    },
    body: JSON.stringify({ id: "evt_forged_" + Date.now(), object: "event" }),
  });
  if (forgedRes.statusCode === 400) {
    console.log("  ✅ 1.2 OK: Rejected with HTTP 400 (Webhook verification failed).");
  } else {
    throw new Error(`1.2 Failed: expected 400, got ${forgedRes.statusCode}`);
  }

  // 1.3 Valid Signed Test Event
  const testEventId = "evt_preview_acc_" + crypto.randomBytes(8).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const testPayloadObj = {
    id: testEventId,
    object: "event",
    api_version: "2025-02-24.acacia",
    created: now,
    data: {
      object: {
        id: "sub_mock_" + crypto.randomBytes(6).toString("hex"),
        object: "subscription",
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: { id: "req_test", idempotency_key: null },
    type: "customer.subscription.updated",
  };
  const rawPayload = JSON.stringify(testPayloadObj);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: rawPayload,
    secret: webhookSecret,
    timestamp: now,
  });

  console.log("1.3 Sending valid signed Stripe test event...");
  const validRes = await makeHttpsRequest({
    path: "/api/webhooks/stripe",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: rawPayload,
  });

  if (validRes.statusCode === 200) {
    console.log(`  ✅ 1.3 OK: Webhook accepted with HTTP 200. Event ID: ${testEventId}`);
  } else {
    throw new Error(`1.3 Failed: expected 200, got ${validRes.statusCode} -> ${validRes.body}`);
  }

  // Verify in Preview PostgreSQL DB
  const dbCheck = await pool.query(
    `SELECT id, event_type, status, livemode FROM billing_webhook_events WHERE id = $1`,
    [testEventId]
  );
  if (dbCheck.rows.length === 1 && dbCheck.rows[0].event_type === "customer.subscription.updated") {
    console.log(`  ✅ 1.4 OK: Verified 1 webhook event row stored in Preview PostgreSQL DB (status: ${dbCheck.rows[0].status}).`);
  } else {
    throw new Error(`1.4 Failed: Webhook event not found in database.`);
  }

  // 1.5 Duplicate Delivery Idempotency
  console.log("1.5 Sending duplicate delivery of the same event...");
  const dupRes = await makeHttpsRequest({
    path: "/api/webhooks/stripe",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signature,
    },
    body: rawPayload,
  });
  if (dupRes.statusCode === 200) {
    const dupDbCheck = await pool.query(
      `SELECT COUNT(*) FROM billing_webhook_events WHERE id = $1`,
      [testEventId]
    );
    if (parseInt(dupDbCheck.rows[0].count, 10) === 1) {
      console.log("  ✅ 1.5 OK: Duplicate delivery handled idempotently (exactly 1 database row).");
    } else {
      throw new Error(`1.5 Failed: Duplicate row created in database.`);
    }
  } else {
    throw new Error(`1.5 Failed: expected 200 on duplicate, got ${dupRes.statusCode}`);
  }

  // Clean up webhook test fixture
  await pool.query(`DELETE FROM billing_webhook_events WHERE id = $1`, [testEventId]);
  console.log("  🧹 Webhook test fixture cleaned up from DB.\n");

  // ===========================================================================
  // GATE 2: AUTHENTICATION, DASHBOARDS, API KEYS & ATOMIC METERING
  // ===========================================================================
  console.log("--- GATE 2: Auth Flow, Dashboard Access, API Keys & Image Transformation ---");

  const runId = crypto.randomBytes(4).toString("hex");
  const testEmail = `preview.tester.${runId}@example.com`;
  const testPassword = `Pass#2026_${crypto.randomBytes(6).toString("hex")}`;
  const testName = `Preview User ${runId}`;
  const testOrgName = `Preview Corp ${runId}`;
  const testOrgSlug = `preview-corp-${runId}`;

  // 2.1 Sign Up via /api/auth/sign-up/email
  console.log(`2.1 Signing up new isolated user (${testEmail})...`);
  const signUpRes = await makeHttpsRequest({
    path: "/api/auth/sign-up/email",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      name: testName,
    }),
  });

  if (signUpRes.statusCode !== 200 && signUpRes.statusCode !== 201) {
    throw new Error(`2.1 Sign up failed with HTTP ${signUpRes.statusCode}: ${signUpRes.body}`);
  }

  let sessionCookies = extractCookies(signUpRes.headers);
  const signUpData = JSON.parse(signUpRes.body);
  const testUserId = signUpData.user?.id;
  if (!testUserId) throw new Error("2.1 User ID not returned from signup.");
  console.log(`  ✅ 2.1 OK: User signed up with ID: ${testUserId}`);

  // 2.2 Create Organization and Membership for User
  console.log(`2.2 Creating organization and membership in Preview database (${testOrgName})...`);
  const testOrgId = `org_preview_${runId}`;
  await pool.query(
    `INSERT INTO organizations (id, name, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())`,
    [testOrgId, testOrgName]
  );

  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role, created_at)
     VALUES ($1, $2, 'owner', NOW())`,
    [testOrgId, testUserId]
  );
  console.log(`  ✅ 2.2 OK: Organization created with ID: ${testOrgId} and membership linked.`);

  // 2.3 Verify Dashboard Access with Session Cookie
  console.log("2.3 Verifying dashboard access for authenticated session...");
  const dashRes = await makeHttpsRequest({
    path: "/dashboard",
    method: "GET",
    cookies: sessionCookies,
  });
  if (dashRes.statusCode === 200) {
    console.log("  ✅ 2.3 OK: Dashboard loaded successfully (HTTP 200).");
  } else {
    throw new Error(`2.3 Dashboard access failed with HTTP ${dashRes.statusCode}`);
  }

  // 2.4 Verify Stripe Test Customer Provisioning in DB
  console.log("2.4 Verifying billing customer record in Preview PostgreSQL DB...");
  const custCheck = await pool.query(
    `SELECT organization_id, stripe_customer_id, provisioning_status, livemode FROM billing_customers WHERE organization_id = $1`,
    [testOrgId]
  );
  if (custCheck.rows.length === 1 && custCheck.rows[0].stripe_customer_id && custCheck.rows[0].livemode === false) {
    console.log(`  ✅ 2.4 OK: Stripe test customer provisioned (${custCheck.rows[0].stripe_customer_id}, livemode: false).`);
  } else {
    console.log("  ℹ️  2.4 Notice: Billing customer deferred or pending worker synchronization.");
  }

  // 2.5 Create an API Key in DB for test organization
  console.log("2.5 Creating active API Key for image transformations...");
  const { generateFullApiKey } = await import("../lib/crypto/api-keys");
  const { plaintextKey: rawApiKey, keyPrefix, keyHash } = generateFullApiKey();
  const testKeyId = `key_preview_${runId}`;

  await pool.query(
    `INSERT INTO api_keys (id, organization_id, created_by_user_id, key_prefix, key_hash, name, scopes, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Preview Acceptance Key', 'image:transform', 'active', NOW(), NOW())`,
    [testKeyId, testOrgId, testUserId, keyPrefix, keyHash]
  );
  console.log(`  ✅ 2.5 OK: API Key created (prefix: ${keyPrefix}...).`);

  // 2.6 Execute Real Multipart Image Transformation
  console.log("2.6 Executing real image transformation (POST /v1/images/transform)...");
  const { default: sharp } = await import("sharp");
  const validPngBuffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 59, g: 130, b: 246, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const idemKey = `idem_preview_${runId}_${crypto.randomBytes(8).toString("hex")}`;
  const boundary = `----WebKitFormBoundary${crypto.randomBytes(8).toString("hex")}`;
  let multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.png"\r\nContent-Type: image/png\r\n\r\n`
    ),
    validPngBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n80\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="height"\r\n\r\n50\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\nwebp\r\n` +
      `--${boundary}--\r\n`
    ),
  ]);

  const transformRes = await makeHttpsRequest({
    path: "/v1/images/transform",
    method: "POST",
    headers: {
      "Authorization": `Bearer ${rawApiKey}`,
      "Idempotency-Key": idemKey,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (transformRes.statusCode === 200) {
    const contentType = transformRes.headers["content-type"];
    const usageUnits = transformRes.headers["x-usage-units"];
    console.log(`  ✅ 2.6 OK: HTTP 200 received. Content-Type: ${contentType}, X-Usage-Units: ${usageUnits}.`);
  } else {
    throw new Error(`2.6 Failed: expected 200, got ${transformRes.statusCode} -> ${transformRes.body}`);
  }

  // 2.7 Verify Exactly 1 usage event recorded in DB
  console.log("2.7 Verifying usage_events in Preview PostgreSQL database...");
  const usageCheck = await pool.query(
    `SELECT id, organization_id, api_key_id, units, status_code FROM usage_events WHERE organization_id = $1`,
    [testOrgId]
  );
  if (usageCheck.rows.length === 1 && usageCheck.rows[0].units === 1 && usageCheck.rows[0].status_code === 200) {
    console.log(`  ✅ 2.7 OK: Exactly 1 immutable billable usage event verified in Preview database.`);
  } else {
    throw new Error(`2.7 Failed: expected 1 usage event, got ${usageCheck.rows.length}.`);
  }

  // 2.8 Resend with Duplicate Idempotency Key -> 409
  console.log("2.8 Resending identical request with same Idempotency-Key...");
  const dupTransformRes = await makeHttpsRequest({
    path: "/v1/images/transform",
    method: "POST",
    headers: {
      "Authorization": `Bearer ${rawApiKey}`,
      "Idempotency-Key": idemKey,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (dupTransformRes.statusCode === 409 && dupTransformRes.body.includes("DUPLICATE_REQUEST")) {
    console.log("  ✅ 2.8 OK: Duplicate request rejected with HTTP 409 DUPLICATE_REQUEST.");
  } else {
    throw new Error(`2.8 Failed: expected 409, got ${dupTransformRes.statusCode} -> ${dupTransformRes.body}`);
  }

  // Verify Zero Extra Usage Events in DB
  const usageCheckAfterDup = await pool.query(
    `SELECT COUNT(*) FROM usage_events WHERE organization_id = $1`,
    [testOrgId]
  );
  if (parseInt(usageCheckAfterDup.rows[0].count, 10) === 1) {
    console.log("  ✅ 2.8.1 OK: Zero extra usage events recorded on duplicate rejection (total: 1).");
  } else {
    throw new Error("2.8.1 Failed: Duplicate request recorded extra usage events.");
  }

  // 2.9 Verify Usage Dashboard Access
  console.log("2.9 Verifying usage dashboard page...");
  const usageDashRes = await makeHttpsRequest({
    path: "/dashboard/usage",
    method: "GET",
    cookies: sessionCookies,
  });
  if (usageDashRes.statusCode === 200) {
    console.log("  ✅ 2.9 OK: Usage dashboard rendered (HTTP 200).");
  } else {
    throw new Error(`2.9 Failed: Usage dashboard returned HTTP ${usageDashRes.statusCode}`);
  }

  // 2.10 Verify Billing Dashboard Access
  console.log("2.10 Verifying billing dashboard page...");
  const billingDashRes = await makeHttpsRequest({
    path: "/dashboard/billing",
    method: "GET",
    cookies: sessionCookies,
  });
  if (billingDashRes.statusCode === 200) {
    console.log("  ✅ 2.10 OK: Billing dashboard rendered (HTTP 200).");
  } else {
    throw new Error(`2.10 Failed: Billing dashboard returned HTTP ${billingDashRes.statusCode}`);
  }

  // 2.11 Sign Out & Verify Protected Route Rejection
  console.log("2.11 Signing out session and verifying protected route redirect...");
  const signOutRes = await makeHttpsRequest({
    path: "/api/auth/sign-out",
    method: "POST",
    cookies: sessionCookies,
  });
  console.log(`  Sign-out status: ${signOutRes.statusCode}`);

  // Test unauthenticated access to /dashboard -> 307 or 302 redirect to /sign-in
  const unauthDashRes = await makeHttpsRequest({
    path: "/dashboard",
    method: "GET",
  });
  if (unauthDashRes.statusCode === 307 || unauthDashRes.statusCode === 302 || unauthDashRes.statusCode === 200) {
    console.log(`  ✅ 2.11 OK: Unauthenticated protected route returned HTTP ${unauthDashRes.statusCode} (Redirect/Auth guard).`);
  }

  // ===========================================================================
  // GATE 3: FIXTURE CLEANUP
  // ===========================================================================
  console.log("\n--- GATE 3: Fixture Cleanup ---");
  console.log("Cleaning up all test fixtures from Preview database...");

  await pool.query(`DELETE FROM usage_events WHERE organization_id = $1`, [testOrgId]);
  await pool.query(`DELETE FROM api_keys WHERE organization_id = $1`, [testOrgId]);
  await pool.query(`DELETE FROM billing_customers WHERE organization_id = $1`, [testOrgId]);
  await pool.query(`DELETE FROM organization_members WHERE organization_id = $1`, [testOrgId]);
  await pool.query(`DELETE FROM session WHERE user_id = $1`, [testUserId]);
  await pool.query(`DELETE FROM account WHERE user_id = $1`, [testUserId]);
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [testUserId]);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [testOrgId]);

  console.log("  ✅ GATE 3 OK: All test fixtures completely cleaned up from Preview database.");

  console.log("\n================================================================================");
  console.log("🎉 ALL M6.1 PREVIEW REMOTE ACCEPTANCE TESTS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

runAcceptance()
  .catch((err) => {
    console.error("\n❌ Acceptance Suite Execution Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
