import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import Stripe from "stripe";
import { assertDevelopmentDatabaseSafety } from "@/db/development-safety";
import { validatePostgresUrlSecurity } from "@/db/ssl-validation";
import { verifyAndRecordWebhookEvent } from "@/lib/services/billing-webhooks";
import crypto from "node:crypto";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

describe("Stripe Signed Webhook Processing & Idempotency Integration Tests", () => {
  let pool: Pool;
  const testSecret = "whsec_test_mock_webhook_secret_1234567890abcdef";
  const trackedEventIds: string[] = [];

  beforeAll(async () => {
    assertDevelopmentDatabaseSafety();
    const dbUrl = process.env.DATABASE_URL!;
    validatePostgresUrlSecurity(dbUrl, "DATABASE_URL");
    pool = new Pool({ connectionString: dbUrl, max: 2 });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      if (trackedEventIds.length > 0) {
        await pool.query(
          `DELETE FROM billing_webhook_events WHERE id = ANY($1::text[])`,
          [trackedEventIds]
        );
      }
    } finally {
      await pool.end();
    }
  });

  it("verifies and durably records a valid signed webhook event", async () => {
    const stripe = new Stripe("sk_test_placeholder_key_for_webhook_tests_123", {
      apiVersion: "2026-07-29.dahlia",
    });

    const eventId = `evt_test_${crypto.randomUUID().replace(/-/g, "")}`;
    trackedEventIds.push(eventId);

    const payload = JSON.stringify({
      id: eventId,
      object: "event",
      api_version: "2026-07-29.dahlia",
      created: Math.floor(Date.now() / 1000),
      type: "customer.subscription.updated",
      livemode: false,
      data: {
        object: {
          id: "sub_test_123",
          object: "subscription",
        },
      },
    });

    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET || testSecret,
    });

    // If STRIPE_WEBHOOK_SECRET is configured in env, test through service
    if (process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      const res = await verifyAndRecordWebhookEvent(payload, signature);
      expect(res.accepted).toBe(true);
      expect(res.eventId).toBe(eventId);

      // Verify row in DB
      const dbCheck = await pool.query(
        `SELECT * FROM billing_webhook_events WHERE id = $1`,
        [eventId]
      );
      expect(dbCheck.rows.length).toBe(1);
      expect(["pending", "processed", "failed"]).toContain(dbCheck.rows[0].status);
      expect(dbCheck.rows[0].event_type).toBe("customer.subscription.updated");

      // Resending same event (duplicate delivery) must succeed idempotently without error
      const dupRes = await verifyAndRecordWebhookEvent(payload, signature);
      expect(dupRes.accepted).toBe(true);

      const dbCheck2 = await pool.query(
        `SELECT COUNT(*) FROM billing_webhook_events WHERE id = $1`,
        [eventId]
      );
      expect(parseInt(dbCheck2.rows[0].count, 10)).toBe(1);
    }
  });

  it("rejects altered payload or forged signature", async () => {
    const stripe = new Stripe("sk_test_placeholder_key_for_webhook_tests_123", {
      apiVersion: "2026-07-29.dahlia",
    });

    const payload = JSON.stringify({
      id: `evt_tamper_${crypto.randomUUID()}`,
      object: "event",
      created: Math.floor(Date.now() / 1000),
      type: "invoice.paid",
      livemode: false,
    });

    const validSignature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_different_key_1234567890abcdef",
    });

    if (process.env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
      await expect(
        verifyAndRecordWebhookEvent(payload, validSignature)
      ).rejects.toThrow();

      await expect(
        verifyAndRecordWebhookEvent(payload + "tampered", validSignature)
      ).rejects.toThrow();
    }
  });
});
