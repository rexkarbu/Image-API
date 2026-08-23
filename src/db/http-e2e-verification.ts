import { Pool } from "pg";
import * as dotenv from "dotenv";
import crypto from "node:crypto";
import sharp from "sharp";
import { assertDevelopmentDatabaseSafety } from "./development-safety";
import { deriveRequestId } from "../lib/api/idempotency";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const ALLOWED_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Strictly validates the HTTP E2E target base URL before making any network calls or database writes.
 * Rejects remote origins, URL credentials, and non-loopback hosts fail-closed.
 */
function validateTargetOrigin(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid HTTP_E2E_BASE_URL: '${rawUrl}'. Must be a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid protocol '${parsed.protocol}'. Only http: and https: are allowed.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error("HTTP_E2E_BASE_URL must not contain embedded user credentials.");
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    throw new Error(`HTTP_E2E_BASE_URL must not contain a path component (got '${parsed.pathname}').`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `Security Violation: Target host '${hostname}' is not a permitted loopback origin. Real HTTP E2E tests must only target local development servers.`
    );
  }

  return parsed.origin;
}

async function generateTestPng(w = 120, h = 80): Promise<Buffer> {
  return await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 60, g: 120, b: 180 },
    },
  })
    .png()
    .toBuffer();
}

function buildMultipartBody(
  fields: Record<string, string | null>,
  fileBuffer: Buffer,
  boundary: string
): Buffer {
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

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="input.png"\r\nContent-Type: image/png\r\n\r\n`
    )
  );
  chunks.push(fileBuffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  return Buffer.concat(chunks);
}

async function runHttpE2E() {
  // Step 0: Enforce strict centralized development database safety guard
  assertDevelopmentDatabaseSafety();

  const targetOrigin = validateTargetOrigin(
    process.env.HTTP_E2E_BASE_URL || "http://127.0.0.1:3000"
  );

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
  });

  const testId = crypto.randomUUID().slice(0, 8);
  const testUserId = `http-e2e-user-${testId}`;
  const testOrgId = `http-e2e-org-${testId}`;

  // Pre-generate keys
  const testKeyId = `http-e2e-key-${testId}`;
  const rawSecret = crypto.randomBytes(32).toString("base64url");
  const plaintextKey = `img_live_${rawSecret}`;
  const keyPrefix = plaintextKey.slice(0, 17);
  const keyHash = crypto.createHash("sha256").update(plaintextKey, "utf8").digest("hex").toLowerCase();

  const revokedKeyId = `http-e2e-revoked-${testId}`;
  const rawRevokedSecret = crypto.randomBytes(32).toString("base64url");
  const plaintextRevokedKey = `img_live_${rawRevokedSecret}`;
  const revokedPrefix = plaintextRevokedKey.slice(0, 17);
  const revokedHash = crypto.createHash("sha256").update(plaintextRevokedKey, "utf8").digest("hex").toLowerCase();

  const expiredKeyId = `http-e2e-expired-${testId}`;
  const rawExpiredSecret = crypto.randomBytes(32).toString("base64url");
  const plaintextExpiredKey = `img_live_${rawExpiredSecret}`;
  const expiredPrefix = plaintextExpiredKey.slice(0, 17);
  const expiredHash = crypto.createHash("sha256").update(plaintextExpiredKey, "utf8").digest("hex").toLowerCase();

  const trackedKeyIds = [testKeyId, revokedKeyId, expiredKeyId];
  const trackedRequestDigests: string[] = [];

  console.log("==================================================");
  console.log("🚀 Starting Milestone 2 Real HTTP & Metering Verification");
  console.log(`🎯 Target Origin: ${targetOrigin}`);
  console.log("==================================================");

  let runError: Error | null = null;

  try {
    // 1. Setup Isolated Test Fixtures in PostgreSQL
    console.log("\n[Step 1] Creating isolated test user, organization, and API key fixtures...");
    const now = new Date();
    const past = new Date(Date.now() - 3600 * 1000); // 1 hour ago
    const older = new Date(Date.now() - 7200 * 1000); // 2 hours ago

    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, true, $4, $4)`,
      [testUserId, `HTTP E2E Tester ${testId}`, `http-e2e-${testId}@example.com`, now]
    );

    await pool.query(
      `INSERT INTO "organizations" (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [testOrgId, `HTTP E2E Org ${testId}`, now]
    );

    await pool.query(
      `INSERT INTO "organization_members" (organization_id, user_id, role, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [testOrgId, testUserId, now]
    );

    // Active key
    await pool.query(
      `INSERT INTO "api_keys" (id, name, organization_id, created_by_user_id, status, scopes, key_prefix, key_hash, created_at, updated_at)
       VALUES ($1, 'HTTP E2E Active Key', $2, $3, 'active', 'image:transform', $4, $5, $6, $6)`,
      [testKeyId, testOrgId, testUserId, keyPrefix, keyHash, now]
    );

    // Revoked key
    await pool.query(
      `INSERT INTO "api_keys" (id, name, organization_id, created_by_user_id, status, scopes, key_prefix, key_hash, revoked_at, created_at, updated_at)
       VALUES ($1, 'HTTP E2E Revoked Key', $2, $3, 'revoked', 'image:transform', $4, $5, $6, $7, $7)`,
      [revokedKeyId, testOrgId, testUserId, revokedPrefix, revokedHash, now, older]
    );

    // Expired key
    await pool.query(
      `INSERT INTO "api_keys" (id, name, organization_id, created_by_user_id, status, scopes, key_prefix, key_hash, expires_at, created_at, updated_at)
       VALUES ($1, 'HTTP E2E Expired Key', $2, $3, 'active', 'image:transform', $4, $5, $6, $7, $7)`,
      [expiredKeyId, testOrgId, testUserId, expiredPrefix, expiredHash, past, older]
    );

    console.log("✅ Step 1 OK: Fixtures created cleanly in PostgreSQL.");

    // 2. Real HTTP POST Image Transformation Request (Success)
    console.log("\n[Step 2] Sending real multipart HTTP POST to /v1/images/transform...");
    const successIdempotencyKey = `http-idemp-success-${crypto.randomUUID()}`;
    const successRequestId = deriveRequestId(testOrgId, successIdempotencyKey);
    trackedRequestDigests.push(successRequestId);

    const testImage = await generateTestPng(160, 100);
    const boundary = "----HTTPTestBoundary" + crypto.randomUUID().replace(/-/g, "");
    const body = buildMultipartBody(
      { width: "80", height: "50", fit: "inside", format: "webp", quality: "85" },
      testImage,
      boundary
    );

    const response = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": successIdempotencyKey,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body: new Uint8Array(body),
    });

    if (response.status !== 200) {
      const errText = await response.text();
      throw new Error(`Expected HTTP 200 but received ${response.status}: ${errText}`);
    }

    const contentType = response.headers.get("content-type");
    const usageUnits = response.headers.get("x-usage-units");
    const outWidth = response.headers.get("x-image-width");
    const outHeight = response.headers.get("x-image-height");
    const requestIdHeader = response.headers.get("x-request-id");

    if (contentType !== "image/webp") throw new Error(`Unexpected Content-Type: ${contentType}`);
    if (usageUnits !== "1") throw new Error(`Unexpected X-Usage-Units: ${usageUnits}`);
    if (outWidth !== "80" || outHeight !== "50") {
      throw new Error(`Unexpected output dimensions: ${outWidth}x${outHeight}`);
    }
    if (!requestIdHeader) throw new Error("Missing X-Request-ID response header.");

    const outputBinary = Buffer.from(await response.arrayBuffer());
    const outputMeta = await sharp(outputBinary).metadata();
    if (outputMeta.format !== "webp" || outputMeta.width !== 80 || outputMeta.height !== 50) {
      throw new Error(`Transformed binary verification failed: format=${outputMeta.format} dimensions=${outputMeta.width}x${outputMeta.height}`);
    }
    console.log(`✅ Step 2 OK: HTTP 200 binary response verified (Format: ${outputMeta.format}, Dimensions: ${outputMeta.width}x${outputMeta.height}, Units: 1).`);

    // 3. Verify Exact PostgreSQL Usage Event Recording
    console.log("\n[Step 3] Verifying exact usage_events row in PostgreSQL...");
    const usageCheck = await pool.query(
      `SELECT * FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [testOrgId, successRequestId]
    );

    if (usageCheck.rows.length !== 1) {
      throw new Error(`Expected exactly 1 usage_event row, found ${usageCheck.rows.length}`);
    }

    const row = usageCheck.rows[0];
    if (row.api_key_id !== testKeyId) throw new Error("Mismatch in usage_events.api_key_id");
    if (row.endpoint !== "/v1/images/transform") throw new Error("Mismatch in usage_events.endpoint");
    if (row.units !== 1) throw new Error("Mismatch in usage_events.units");
    if (row.status_code !== 200) throw new Error("Mismatch in usage_events.status_code");
    console.log("✅ Step 3 OK: Exactly 1 immutable billable usage event verified in PostgreSQL database.");

    // 4. Sequential Duplicate Idempotency Key Rejection
    console.log("\n[Step 4] Resending identical request with same Idempotency-Key (Sequential Duplicate)...");
    const dupResponse = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": successIdempotencyKey,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body: new Uint8Array(body),
    });

    if (dupResponse.status !== 409) {
      throw new Error(`Expected HTTP 409 for duplicate request but got ${dupResponse.status}`);
    }

    const dupBody = await dupResponse.json();
    if (dupBody.error?.code !== "DUPLICATE_REQUEST") {
      throw new Error(`Expected error code DUPLICATE_REQUEST, got ${dupBody.error?.code}`);
    }
    console.log("✅ Step 4 OK: HTTP 409 DUPLICATE_REQUEST returned.");

    // 5. Concurrent Duplicate Requests (5 parallel requests)
    console.log("\n[Step 5] Launching 5 concurrent identical requests (Race Condition & Deduplication)...");
    const parallelKey = `http-idemp-parallel-${crypto.randomUUID()}`;
    const parallelRequestId = deriveRequestId(testOrgId, parallelKey);
    trackedRequestDigests.push(parallelRequestId);

    const parallelResponses = await Promise.all([
      fetch(`${targetOrigin}/v1/images/transform`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${plaintextKey}`,
          "Idempotency-Key": parallelKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      }),
      fetch(`${targetOrigin}/v1/images/transform`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${plaintextKey}`,
          "Idempotency-Key": parallelKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      }),
      fetch(`${targetOrigin}/v1/images/transform`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${plaintextKey}`,
          "Idempotency-Key": parallelKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      }),
      fetch(`${targetOrigin}/v1/images/transform`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${plaintextKey}`,
          "Idempotency-Key": parallelKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      }),
      fetch(`${targetOrigin}/v1/images/transform`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${plaintextKey}`,
          "Idempotency-Key": parallelKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: new Uint8Array(body),
      }),
    ]);

    const successes = parallelResponses.filter((r) => r.status === 200);
    const duplicates = parallelResponses.filter((r) => r.status === 409);

    if (successes.length !== 1 || duplicates.length !== 4) {
      throw new Error(`Expected 1 HTTP 200 and 4 HTTP 409s, got ${successes.length} 200s and ${duplicates.length} 409s.`);
    }

    const parallelDbCheck = await pool.query(
      `SELECT COUNT(*) FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [testOrgId, parallelRequestId]
    );
    if (parseInt(parallelDbCheck.rows[0].count, 10) !== 1) {
      throw new Error(`Expected exactly 1 DB row for concurrent requests, got ${parallelDbCheck.rows[0].count}`);
    }
    console.log("✅ Step 5 OK: Exactly 1 winning request (200), 4 conflicts (409), exactly 1 database row.");

    // 6. Uniform Indistinguishable 401 UNAUTHORIZED Checks
    console.log("\n[Step 6] Testing uniform authentication failures (indistinguishable 401s)...");
    const authTestCases: { name: string; headers: Record<string, string> }[] = [
      { name: "Missing Authorization header", headers: {} },
      { name: "Wrong scheme (Basic)", headers: { Authorization: "Basic dXNlcjpwYXNz" } },
      { name: "Empty Bearer", headers: { Authorization: "Bearer  " } },
      { name: "Unknown Key", headers: { Authorization: "Bearer img_live_nonexistentkey12345678901234567890" } },
      { name: "Revoked Key", headers: { Authorization: `Bearer ${plaintextRevokedKey}` } },
      { name: "Expired Key", headers: { Authorization: `Bearer ${plaintextExpiredKey}` } },
    ];

    for (const testCase of authTestCases) {
      const authRes = await fetch(`${targetOrigin}/v1/images/transform`, {
        method: "POST",
        headers: {
          "Idempotency-Key": `idemp-auth-${crypto.randomUUID()}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          ...testCase.headers,
        },
        body: new Uint8Array(body),
      });

      if (authRes.status !== 401) {
        throw new Error(`Expected 401 for '${testCase.name}', got ${authRes.status}`);
      }

      const resJson = await authRes.json();
      if (resJson.error?.code !== "UNAUTHORIZED" || resJson.error?.message !== "Invalid API credentials.") {
        throw new Error(
          `Rejection body not uniform for '${testCase.name}': code=${resJson.error?.code} message=${resJson.error?.message}`
        );
      }
    }
    console.log("✅ Step 6 OK: All 6 authentication failure cases returned identical 401 UNAUTHORIZED responses.");

    // 7. Testing Bad Options, Fit Validation, Corrupt & Unsupported Inputs
    console.log("\n[Step 7] Testing input validation, fit validation, corrupt and unsupported formats...");

    // PNG with quality -> 400
    const badOptBoundary = "----BadOpt" + crypto.randomUUID().replace(/-/g, "");
    const badOptBody = buildMultipartBody({ format: "png", quality: "90" }, testImage, badOptBoundary);
    const badOptRes = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": `idemp-badopt-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${badOptBoundary}`,
      },
      body: new Uint8Array(badOptBody),
    });
    if (badOptRes.status !== 400) throw new Error(`Expected 400 for PNG with quality, got ${badOptRes.status}`);

    // Fit specified without height -> 400
    const badFitBoundary = "----BadFit" + crypto.randomUUID().replace(/-/g, "");
    const badFitBody = buildMultipartBody({ width: "100", fit: "cover" }, testImage, badFitBoundary);
    const badFitRes = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": `idemp-badfit-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${badFitBoundary}`,
      },
      body: new Uint8Array(badFitBody),
    });
    if (badFitRes.status !== 400) throw new Error(`Expected 400 for fit without height, got ${badFitRes.status}`);

    // Corrupt image -> 422
    const corruptBoundary = "----Corrupt" + crypto.randomUUID().replace(/-/g, "");
    const corruptBody = buildMultipartBody({}, Buffer.from("not-an-image-corrupt-data"), corruptBoundary);
    const corruptRes = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": `idemp-corrupt-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${corruptBoundary}`,
      },
      body: new Uint8Array(corruptBody),
    });
    if (corruptRes.status !== 422) throw new Error(`Expected 422 for corrupt image, got ${corruptRes.status}`);

    // Unsupported format (SVG) -> 415
    const svgBoundary = "----Svg" + crypto.randomUUID().replace(/-/g, "");
    const svgBody = buildMultipartBody(
      {},
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="blue"/></svg>'),
      svgBoundary
    );
    const svgRes = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": `idemp-svg-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${svgBoundary}`,
      },
      body: new Uint8Array(svgBody),
    });
    if (svgRes.status !== 415) throw new Error(`Expected 415 for SVG, got ${svgRes.status}`);

    // Oversized body (>10 MiB) -> 413
    const bigBoundary = "----Big" + crypto.randomUUID().replace(/-/g, "");
    const bigBody = buildMultipartBody({}, Buffer.alloc(10.5 * 1024 * 1024), bigBoundary);
    const bigRes = await fetch(`${targetOrigin}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": `idemp-big-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${bigBoundary}`,
      },
      body: new Uint8Array(bigBody),
    });
    if (bigRes.status !== 413) throw new Error(`Expected 413 for oversized file, got ${bigRes.status}`);

    console.log("✅ Step 7 OK: Validation, fit gating, corrupt bytes, unsupported formats, and 413 payload limits verified.");

    // 8. Total Billable Usage Assertion
    console.log("\n[Step 8] Checking total usage_events count for test organization...");
    const totalUsage = await pool.query(
      `SELECT COUNT(*) FROM usage_events WHERE organization_id = $1`,
      [testOrgId]
    );
    const count = parseInt(totalUsage.rows[0].count, 10);
    // Exactly 2 successful transformations (Step 2 and winning request in Step 5)
    if (count !== 2) {
      throw new Error(`Expected exactly 2 billable usage rows, found ${count}. Failed/duplicate requests recorded illegal usage!`);
    }
    console.log(`✅ Step 8 OK: Exactly 2 billable usage rows verified in database (0 rows for all rejected/duplicate requests).`);

    console.log("\n==================================================");
    console.log("🎉 ALL REAL HTTP TRANSFORMATION & METERING CHECKS PASSED!");
    console.log("==================================================");
  } catch (err) {
    runError = err as Error;
    console.error("❌ HTTP E2E Verification Failed:", (err as Error).message || err);
    process.exitCode = 1;
  } finally {
    console.log("\n🧹 Cleaning up test fixtures...");
    try {
      if (trackedRequestDigests.length > 0) {
        await pool.query(
          `DELETE FROM usage_events WHERE organization_id = $1 OR request_id = ANY($2::text[])`,
          [testOrgId, trackedRequestDigests]
        );
      }
      if (trackedKeyIds.length > 0) {
        await pool.query(`DELETE FROM api_key_audit_events WHERE api_key_id = ANY($1::text[])`, [trackedKeyIds]);
        await pool.query(`DELETE FROM api_keys WHERE id = ANY($1::text[])`, [trackedKeyIds]);
      }
      if (testOrgId) {
        await pool.query(`DELETE FROM organization_members WHERE organization_id = $1`, [testOrgId]);
        await pool.query(`DELETE FROM organizations WHERE id = $1`, [testOrgId]);
      }
      await pool.query(`DELETE FROM "user" WHERE id = $1`, [testUserId]);
      console.log("✅ Fixture cleanup complete.");
    } catch (cleanErr) {
      console.error("⚠️ Cleanup failed for test run:", (cleanErr as Error).message || cleanErr);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }

  if (runError) {
    throw runError;
  }
}

runHttpE2E();
