import { Pool } from "pg";
import * as dotenv from "dotenv";
import crypto from "node:crypto";
import sharp from "sharp";
import { assertDevelopmentDatabaseSafety } from "./development-safety";
import { deriveRequestId } from "../lib/api/idempotency";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";

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
  assertDevelopmentDatabaseSafety();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  const testId = crypto.randomUUID().slice(0, 8);
  const testUserId = `http-e2e-user-${testId}`;
  const testOrgId = `http-e2e-org-${testId}`;
  const testKeyId = `http-e2e-key-${testId}`;

  const rawSecret = crypto.randomBytes(32).toString("base64url");
  const plaintextKey = `img_live_${rawSecret}`;
  const keyPrefix = plaintextKey.slice(0, 17);
  const keyHash = crypto.createHash("sha256").update(plaintextKey, "utf8").digest("hex").toLowerCase();
  const displayPrefix = `${keyPrefix}••••••••`;

  const createdKeyIds: string[] = [testKeyId];
  const createdUsageIds: string[] = [];

  console.log("==================================================");
  console.log("🚀 Starting Milestone 2 Real HTTP & Metering Verification");
  console.log(`🎯 Target URL: ${BASE_URL}/v1/images/transform`);
  console.log("==================================================");

  try {
    // 1. Setup Isolated Test Fixtures in PostgreSQL
    console.log("\n[Step 1] Creating isolated test user, organization, and API key fixtures...");
    const now = new Date();
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

    await pool.query(
      `INSERT INTO "api_keys" (id, name, organization_id, created_by_user_id, status, scopes, key_prefix, key_hash, created_at, updated_at)
       VALUES ($1, 'HTTP E2E Production Key', $2, $3, 'active', 'image:transform', $4, $5, $6, $6)`,
      [testKeyId, testOrgId, testUserId, keyPrefix, keyHash, now]
    );

    console.log(`✅ Step 1 OK: Fixtures created in DB (Prefix: ${displayPrefix}).`);

    // 2. Real HTTP POST Image Transformation Request
    console.log("\n[Step 2] Sending real multipart HTTP POST to /v1/images/transform...");
    const idempotencyKey = `http-idemp-${crypto.randomUUID()}`;
    const testImage = await generateTestPng(160, 100);
    const boundary = "----HTTPTestBoundary" + crypto.randomUUID().replace(/-/g, "");
    const body = buildMultipartBody(
      { width: "80", format: "webp", quality: "85" },
      testImage,
      boundary
    );

    const response = await fetch(`${BASE_URL}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": idempotencyKey,
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
    const requestId = response.headers.get("x-request-id");

    if (contentType !== "image/webp") throw new Error(`Unexpected Content-Type: ${contentType}`);
    if (usageUnits !== "1") throw new Error(`Unexpected X-Usage-Units: ${usageUnits}`);
    if (outWidth !== "80" || outHeight !== "50") {
      throw new Error(`Unexpected output dimensions: ${outWidth}x${outHeight}`);
    }
    if (!requestId) throw new Error("Missing X-Request-ID response header.");

    const outputBinary = Buffer.from(await response.arrayBuffer());
    const outputMeta = await sharp(outputBinary).metadata();
    if (outputMeta.format !== "webp" || outputMeta.width !== 80 || outputMeta.height !== 50) {
      throw new Error(`Transformed binary verification failed: format=${outputMeta.format} dimensions=${outputMeta.width}x${outputMeta.height}`);
    }
    console.log(`✅ Step 2 OK: HTTP 200 binary response verified (Format: ${outputMeta.format}, Dimensions: ${outputMeta.width}x${outputMeta.height}, Units: 1).`);

    // 3. Verify Exact PostgreSQL Usage Event Recording
    console.log("\n[Step 3] Verifying exact usage_events row in PostgreSQL...");
    const expectedRequestId = deriveRequestId(testOrgId, idempotencyKey);
    const usageCheck = await pool.query(
      `SELECT * FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [testOrgId, expectedRequestId]
    );

    if (usageCheck.rows.length !== 1) {
      throw new Error(`Expected exactly 1 usage_event row, found ${usageCheck.rows.length}`);
    }

    const row = usageCheck.rows[0];
    createdUsageIds.push(row.id);

    if (row.api_key_id !== testKeyId) throw new Error("Mismatch in usage_events.api_key_id");
    if (row.endpoint !== "/v1/images/transform") throw new Error("Mismatch in usage_events.endpoint");
    if (row.units !== 1) throw new Error("Mismatch in usage_events.units");
    if (row.status_code !== 200) throw new Error("Mismatch in usage_events.status_code");
    console.log("✅ Step 3 OK: Exactly 1 immutable billable usage event verified in PostgreSQL database.");

    // 4. Sequential Duplicate Idempotency Key Rejection
    console.log("\n[Step 4] Resending identical request with same Idempotency-Key (Duplicate Check)...");
    const dupResponse = await fetch(`${BASE_URL}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": idempotencyKey,
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

    // Verify DB still contains only 1 row
    const dupDbCheck = await pool.query(
      `SELECT COUNT(*) FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [testOrgId, expectedRequestId]
    );
    if (parseInt(dupDbCheck.rows[0].count, 10) !== 1) {
      throw new Error("Duplicate request created an additional database row!");
    }
    console.log("✅ Step 4 OK: HTTP 409 DUPLICATE_REQUEST returned; zero additional usage recorded.");

    // 5. Failure Path Gating: Invalid Authentication & Bad Options
    console.log("\n[Step 5] Testing failure paths (zero usage recording guarantees)...");

    // Invalid Key
    const badAuthRes = await fetch(`${BASE_URL}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: "Bearer img_live_invalidkey123456789012345678901234567890",
        "Idempotency-Key": `bad-auth-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    });
    if (badAuthRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for bad auth, got ${badAuthRes.status}`);
    }

    // Bad Options (PNG with quality)
    const badOptionsBoundary = "----BadOptBoundary" + crypto.randomUUID().replace(/-/g, "");
    const badOptionsBody = buildMultipartBody(
      { format: "png", quality: "90" },
      testImage,
      badOptionsBoundary
    );
    const badOptRes = await fetch(`${BASE_URL}/v1/images/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintextKey}`,
        "Idempotency-Key": `bad-opt-${crypto.randomUUID()}`,
        "Content-Type": `multipart/form-data; boundary=${badOptionsBoundary}`,
      },
      body: new Uint8Array(badOptionsBody),
    });
    if (badOptRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for bad options, got ${badOptRes.status}`);
    }

    // Confirm total usage rows for org is still exactly 1
    const totalOrgUsage = await pool.query(
      `SELECT COUNT(*) FROM usage_events WHERE organization_id = $1`,
      [testOrgId]
    );
    if (parseInt(totalOrgUsage.rows[0].count, 10) !== 1) {
      throw new Error(`Unexpected usage rows count: ${totalOrgUsage.rows[0].count}`);
    }
    console.log("✅ Step 5 OK: All failure paths rejected without creating billable usage records.");

    console.log("\n==================================================");
    console.log("🎉 ALL REAL HTTP TRANSFORMATION & METERING CHECKS PASSED!");
    console.log("==================================================");
  } catch (err) {
    console.error("❌ HTTP E2E Verification Failed:", (err as Error).message || err);
    process.exit(1);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures...");
    try {
      if (createdUsageIds.length > 0) {
        await pool.query(`DELETE FROM usage_events WHERE id = ANY($1::text[])`, [createdUsageIds]);
      }
      if (createdKeyIds.length > 0) {
        await pool.query(`DELETE FROM api_key_audit_events WHERE api_key_id = ANY($1::text[])`, [createdKeyIds]);
        await pool.query(`DELETE FROM api_keys WHERE id = ANY($1::text[])`, [createdKeyIds]);
      }
      if (testOrgId) {
        await pool.query(`DELETE FROM organization_members WHERE organization_id = $1`, [testOrgId]);
        await pool.query(`DELETE FROM organizations WHERE id = $1`, [testOrgId]);
      }
      await pool.query(`DELETE FROM "user" WHERE id = $1`, [testUserId]);
      console.log("✅ Fixture cleanup complete.");
    } catch (cleanErr) {
      console.error("⚠️ Cleanup error:", cleanErr);
    } finally {
      await pool.end();
    }
  }
}

runHttpE2E();
