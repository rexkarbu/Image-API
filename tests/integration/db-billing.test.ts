import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { assertDevelopmentDatabaseSafety } from "@/db/development-safety";
import { validatePostgresUrlSecurity } from "@/db/ssl-validation";
import crypto from "node:crypto";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

describe("PostgreSQL Billing Schema, Constraints & Tenant Isolation Integration Tests", () => {
  let pool: Pool;
  const testRunId = crypto.randomUUID().slice(0, 8);
  const testUserId = `test-buser-${testRunId}`;
  const testOrgAId = `test-borg-a-${testRunId}`;
  const testOrgBId = `test-borg-b-${testRunId}`;

  beforeAll(async () => {
    assertDevelopmentDatabaseSafety();
    const dbUrl = process.env.DATABASE_URL!;
    validatePostgresUrlSecurity(dbUrl, "DATABASE_URL");
    pool = new Pool({ connectionString: dbUrl, max: 2 });

    const now = new Date();
    // Create test user and organizations
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, true, $4, $4)`,
      [testUserId, `Billing User ${testRunId}`, `buser-${testRunId}@example.com`, now]
    );

    await pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3), ($4, $5, $3, $3)`,
      [testOrgAId, `Billing Org A ${testRunId}`, now, testOrgBId, `Billing Org B ${testRunId}`]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      // Clean up in reverse dependency order
      await pool.query(
        `DELETE FROM billing_usage_batch_items WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM billing_usage_batches WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM billing_reconciliation_runs WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM billing_invoices WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM billing_subscriptions WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM billing_checkout_sessions WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM billing_customers WHERE organization_id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(
        `DELETE FROM organizations WHERE id = ANY($1::text[])`,
        [[testOrgAId, testOrgBId]]
      );
      await pool.query(`DELETE FROM "user" WHERE id = $1`, [testUserId]);
    } finally {
      await pool.end();
    }
  });

  it("enforces single customer provisioning record per organization (PK)", async () => {
    const now = new Date();
    await pool.query(
      `INSERT INTO billing_customers (organization_id, provisioning_idempotency_key, provisioning_status, livemode, created_at, updated_at)
       VALUES ($1, $2, 'pending', false, $3, $3)`,
      [testOrgAId, `idem_${testOrgAId}`, now]
    );

    // Duplicate insert for same organization must fail PK violation
    await expect(
      pool.query(
        `INSERT INTO billing_customers (organization_id, provisioning_idempotency_key, provisioning_status, livemode, created_at, updated_at)
         VALUES ($1, $2, 'pending', false, $3, $3)`,
        [testOrgAId, `idem_dup_${testOrgAId}`, now]
      )
    ).rejects.toThrow();
  });

  it("enforces partial unique index for single active subscription per organization", async () => {
    const now = new Date();
    const future = new Date(Date.now() + 30 * 86400 * 1000);
    const subId1 = `sub_test_1_${testRunId}`;
    const subId2 = `sub_test_2_${testRunId}`;

    await pool.query(
      `INSERT INTO billing_subscriptions (id, organization_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, metering_enabled_at, created_at, updated_at)
       VALUES ($1, $2, 'cus_1', $3, 'price_1', 'active', $4, $5, $4, $4, $4)`,
      [crypto.randomUUID(), testOrgAId, subId1, now, future]
    );

    // Second active subscription for same organization must violate partial unique index
    await expect(
      pool.query(
        `INSERT INTO billing_subscriptions (id, organization_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, metering_enabled_at, created_at, updated_at)
         VALUES ($1, $2, 'cus_1', $3, 'price_1', 'active', $4, $5, $4, $4, $4)`,
        [crypto.randomUUID(), testOrgAId, subId2, now, future]
      )
    ).rejects.toThrow();
  });

  it("enforces partial unique index for single active checkout session per organization", async () => {
    const now = new Date();
    const chkId1 = crypto.randomUUID();
    const chkId2 = crypto.randomUUID();

    await pool.query(
      `INSERT INTO billing_checkout_sessions (id, organization_id, actor_user_id, idempotency_key, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'creating', $5, $5)`,
      [chkId1, testOrgBId, testUserId, `idem_chk_1_${testRunId}`, now]
    );

    // Second creating/open checkout session for Org B must violate partial unique index
    await expect(
      pool.query(
        `INSERT INTO billing_checkout_sessions (id, organization_id, actor_user_id, idempotency_key, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'open', $5, $5)`,
        [chkId2, testOrgBId, testUserId, `idem_chk_2_${testRunId}`, now]
      )
    ).rejects.toThrow();
  });

  it("enforces that one usage event cannot belong to multiple batches", async () => {
    const now = new Date();
    const keyId = `key_${testRunId}`;
    const keyHash = crypto.createHash("sha256").update(keyId).digest("hex");
    const keyPrefix = "img_live_test1234";

    await pool.query(
      `INSERT INTO api_keys (id, name, organization_id, created_by_user_id, status, scopes, key_prefix, key_hash, created_at, updated_at)
       VALUES ($1, 'Test Key', $2, $3, 'active', 'image:transform', $4, $5, $6, $6)`,
      [keyId, testOrgAId, testUserId, keyPrefix, keyHash, now]
    );

    const usageEventId = crypto.randomUUID();
    const requestId = crypto.randomBytes(32).toString("hex");

    await pool.query(
      `INSERT INTO usage_events (id, request_id, organization_id, api_key_id, endpoint, units, status_code, created_at)
       VALUES ($1, $2, $3, $4, '/v1/images/transform', 1, 200, $5)`,
      [usageEventId, requestId, testOrgAId, keyId, now]
    );

    const batch1Id = crypto.randomUUID();
    const batch2Id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO billing_usage_batches (id, organization_id, stripe_customer_id, window_start, window_end, units, meter_event_identifier, status, created_at, updated_at)
       VALUES ($1, $2, 'cus_1', $3, $4, 1, $5, 'pending', $3, $3),
              ($6, $2, 'cus_1', $3, $4, 1, $7, 'pending', $3, $3)`,
      [
        batch1Id,
        testOrgAId,
        now,
        new Date(now.getTime() + 3600000),
        `imgapi_${batch1Id.replace(/-/g, "")}`,
        batch2Id,
        `imgapi_${batch2Id.replace(/-/g, "")}`,
      ]
    );

    // Map to batch 1
    await pool.query(
      `INSERT INTO billing_usage_batch_items (batch_id, usage_event_id, organization_id)
       VALUES ($1, $2, $3)`,
      [batch1Id, usageEventId, testOrgAId]
    );

    // Mapping the SAME usage event to batch 2 must violate unique constraint on usage_event_id
    await expect(
      pool.query(
        `INSERT INTO billing_usage_batch_items (batch_id, usage_event_id, organization_id)
         VALUES ($1, $2, $3)`,
        [batch2Id, usageEventId, testOrgAId]
      )
    ).rejects.toThrow();

    // Clean up temporary API key and usage events
    await pool.query(`DELETE FROM billing_usage_batch_items WHERE usage_event_id = $1`, [usageEventId]);
    await pool.query(`DELETE FROM usage_events WHERE id = $1`, [usageEventId]);
    await pool.query(`DELETE FROM api_keys WHERE id = $1`, [keyId]);
  });
});
