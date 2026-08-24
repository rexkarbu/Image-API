import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as dotenv from "dotenv";
import { getValidatedStripeConfig, validateStripeMeterAndPrice } from "@/lib/stripe/safety";
import { getStripeClient } from "@/lib/stripe/client";
import { db } from "@/db";
import {
  organizations,
  organizationMembers,
  user,
  apiKeys,
  apiKeyAuditEvents,
  billingCustomers,
  billingSubscriptions,
  billingUsageBatches,
  billingUsageBatchItems,
  billingReconciliationRuns,
  usageEvents,
} from "@/db/schema";
import { runBillingWorker } from "@/lib/services/billing-worker";
import { runReconciliationForOrganization } from "@/lib/services/billing-reconciliation";
import { createApiKey } from "@/lib/services/api-keys";
import { eq, inArray } from "drizzle-orm";
import crypto from "node:crypto";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const shouldRunLiveStripeTests =
  process.env.RUN_STRIPE_INTEGRATION_TESTS === "true" &&
  process.env.STRIPE_ENV === "test" &&
  process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_");

describe.skipIf(!shouldRunLiveStripeTests)(
  "Live Stripe Sandbox Integration Tests (Guarded Test-Mode)",
  () => {
    let testCustomerId: string | null = null;
    const testRunId = crypto.randomUUID().slice(0, 8);

    beforeAll(async () => {
      const config = getValidatedStripeConfig({ requireIntegrationTestOptIn: true });
      const stripe = getStripeClient();

      // Retrieve configured meter and price to verify test-mode setup
      const [meter, price] = await Promise.all([
        stripe.billing.meters.retrieve(config.meterId),
        stripe.prices.retrieve(config.meteredPriceId),
      ]);

      validateStripeMeterAndPrice(
        {
          id: meter.id,
          livemode: meter.livemode,
          event_name: meter.event_name,
          status: meter.status,
        },
        {
          id: price.id,
          livemode: price.livemode,
          active: price.active,
          recurring: price.recurring
            ? {
                meter: price.recurring.meter || null,
                usage_type: price.recurring.usage_type,
              }
            : null,
        },
        config.meterEventName
      );
    });

    afterAll(async () => {
      if (testCustomerId) {
        try {
          const stripe = getStripeClient();
          await stripe.customers.del(testCustomerId);
        } catch (err) {
          console.error(`Failed to clean up test customer ${testCustomerId}:`, (err as Error).message);
        }
      }
    });

    it("creates an isolated test customer and Customer Portal session", async () => {
      const stripe = getStripeClient();

      const customer = await stripe.customers.create({
        name: `Integration Test Customer ${testRunId}`,
        metadata: {
          testRunId,
        },
      });

      expect(customer.id).toBeDefined();
      expect(customer.livemode).toBe(false);
      testCustomerId = customer.id;

      // Create a test Customer Portal session
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: "http://localhost:3000/dashboard/billing",
      });

      expect(portalSession.url).toBeDefined();
      expect(portalSession.url.startsWith("https://billing.stripe.com/")).toBe(true);
    });

    it(
      "proves Stripe meter summary convergence, pending_provider -> matched transition, and reconciliation difference = 0",
      async () => {
        const stripe = getStripeClient();
        const config = getValidatedStripeConfig();
        const runId = crypto.randomUUID().slice(0, 8);
        const orgId = `org_test_conv_${runId}`;
        const userId = `usr_test_conv_${runId}`;
        const userEmail = `test-conv-${runId}@example.com`;
        const now = new Date();
        const periodStart = new Date(Date.now() - 3600 * 1000);
        const periodEnd = new Date(Date.now() + 3600 * 1000);

        let fixtureCustomerId: string | null = null;

        try {
          // 1. Create Test User & Org in DB
          await db.insert(user).values({
            id: userId,
            name: `Convergence Test User ${runId}`,
            email: userEmail,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          });

          await db.insert(organizations).values({
            id: orgId,
            name: `Convergence Test Org ${runId}`,
            createdAt: now,
            updatedAt: now,
          });

          await db.insert(organizationMembers).values({
            organizationId: orgId,
            userId,
            role: "owner",
            createdAt: now,
          });

          // Create API key for usage_events foreign key
          const keyResult = await createApiKey(
            { organizationId: orgId, userId, role: "owner" },
            { name: `Convergence API Key ${runId}`, scopes: "image:transform" }
          );

          // 2. Create Stripe Customer
          const cust = await stripe.customers.create({
            name: `Convergence Org Customer ${runId}`,
            metadata: { organizationId: orgId, runId },
          });
          fixtureCustomerId = cust.id;

          await db.insert(billingCustomers).values({
            organizationId: orgId,
            stripeCustomerId: cust.id,
            provisioningIdempotencyKey: `idem_cust_${orgId}`,
            provisioningStatus: "ready",
            livemode: false,
            attemptCount: 1,
            createdAt: now,
            updatedAt: now,
          });

          // 3. Create active subscription in DB
          const subId = `sub_test_${runId}`;
          await db.insert(billingSubscriptions).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            stripeCustomerId: cust.id,
            stripeSubscriptionId: subId,
            stripePriceId: config.meteredPriceId,
            status: "active",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            meteringEnabledAt: periodStart,
            lastEventCreatedAt: now,
            lastEventId: `evt_init_${runId}`,
            createdAt: now,
            updatedAt: now,
          });

          // 4. Create 1 eligible usage event
          const usageEventId = crypto.randomUUID();
          await db.insert(usageEvents).values({
            id: usageEventId,
            organizationId: orgId,
            apiKeyId: keyResult.key.id,
            endpoint: "/v1/images/transform",
            units: 1,
            requestId: crypto.randomBytes(32).toString("hex"),
            statusCode: 200,
            createdAt: now,
          });

          // 5. Run Billing Worker to claim usage and submit Meter Event to Stripe
          const workerRes1 = await runBillingWorker(db, { windowEnd: new Date(Date.now() + 5000) });
          expect(workerRes1.createdBatches).toBeGreaterThanOrEqual(1);
          expect(workerRes1.reportedBatches).toBeGreaterThanOrEqual(1);

          // Verify batch in DB
          const [batch] = await db
            .select()
            .from(billingUsageBatches)
            .where(eq(billingUsageBatches.organizationId, orgId))
            .limit(1);

          expect(batch).toBeDefined();
          expect(batch.status).toBe("reported");
          expect(batch.units).toBe(1);

          // 6. Run initial reconciliation immediately -> proves pending_provider or matched
          const initialRecon = await runReconciliationForOrganization(orgId, periodStart, periodEnd);
          expect(initialRecon.localEligibleUnits).toBe(1);
          expect(initialRecon.batchedUnits).toBe(1);
          expect(initialRecon.reportedUnits).toBe(1);
          expect(["pending_provider", "matched"]).toContain(initialRecon.status);

          // 7. Bounded polling for Stripe Meter Event Summary convergence
          let finalRecon = initialRecon;
          const pollStartTime = Date.now();
          const maxPollMs = 180000; // 3 minutes

          while (Date.now() - pollStartTime < maxPollMs) {
            if (finalRecon.status === "matched" && finalRecon.stripeAggregatedUnits === 1 && finalRecon.difference === 0) {
              break;
            }
            await new Promise((r) => setTimeout(r, 12000));
            finalRecon = await runReconciliationForOrganization(orgId, periodStart, periodEnd);
          }

          // 8. Assert convergence strictly
          expect(finalRecon.status).toBe("matched");
          expect(finalRecon.localEligibleUnits).toBe(1);
          expect(finalRecon.batchedUnits).toBe(1);
          expect(finalRecon.reportedUnits).toBe(1);
          expect(finalRecon.stripeAggregatedUnits).toBe(1);
          expect(finalRecon.difference).toBe(0);

          // 9. Prove worker idempotency: re-running worker does NOT create new batches
          const workerRes2 = await runBillingWorker(db, { windowEnd: new Date(Date.now() + 5000) });
          const extraBatches = await db
            .select()
            .from(billingUsageBatches)
            .where(eq(billingUsageBatches.organizationId, orgId));

          expect(extraBatches.length).toBe(1);
        } finally {
          // 10. Clean up Stripe Customer
          if (fixtureCustomerId) {
            try {
              await stripe.customers.del(fixtureCustomerId);
            } catch (err) {
              console.warn(`Failed to delete fixture customer ${fixtureCustomerId}:`, (err as Error).message);
            }
          }

          // 11. Clean up DB fixtures
          await db.delete(billingUsageBatchItems).where(eq(billingUsageBatchItems.organizationId, orgId));
          await db.delete(billingUsageBatches).where(eq(billingUsageBatches.organizationId, orgId));
          await db.delete(billingReconciliationRuns).where(eq(billingReconciliationRuns.organizationId, orgId));
          await db.delete(billingSubscriptions).where(eq(billingSubscriptions.organizationId, orgId));
          await db.delete(billingCustomers).where(eq(billingCustomers.organizationId, orgId));
          await db.delete(usageEvents).where(eq(usageEvents.organizationId, orgId));

          const keys = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.organizationId, orgId));
          if (keys.length > 0) {
            const keyIds = keys.map((k) => k.id);
            await db.delete(apiKeyAuditEvents).where(inArray(apiKeyAuditEvents.apiKeyId, keyIds));
            await db.delete(apiKeys).where(inArray(apiKeys.id, keyIds));
          }

          await db.delete(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
          await db.delete(organizations).where(eq(organizations.id, orgId));
          await db.delete(user).where(eq(user.id, userId));

          // Verify zero lingering rows
          const [checkOrg] = await db.select().from(organizations).where(eq(organizations.id, orgId));
          expect(checkOrg).toBeUndefined();
        }
      },
      240000 // 4 minute vitest timeout
    );
  }
);
