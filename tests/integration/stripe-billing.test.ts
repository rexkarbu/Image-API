import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as dotenv from "dotenv";
import { getValidatedStripeConfig, validateStripeMeterAndPrice } from "@/lib/stripe/safety";
import { getStripeClient } from "@/lib/stripe/client";
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
    const trackedMeterEventIds: string[] = [];

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

    it("submits a Billing Meter Event and queries meter event summaries", async () => {
      if (!testCustomerId) throw new Error("Test customer not initialized.");

      const config = getValidatedStripeConfig();
      const stripe = getStripeClient();

      const eventIdentifier = `imgapi_test_${testRunId}_${Date.now()}`;
      trackedMeterEventIds.push(eventIdentifier);

      const timestampSeconds = Math.floor(Date.now() / 1000);

      // Submit Meter Event
      const meterEvent = await stripe.billing.meterEvents.create({
        event_name: config.meterEventName,
        payload: {
          stripe_customer_id: testCustomerId,
          value: "5",
        },
        identifier: eventIdentifier,
        timestamp: timestampSeconds,
      });

      expect(meterEvent.identifier).toBe(eventIdentifier);
      expect(meterEvent.livemode).toBe(false);

      // Query summaries for the current minute window
      const startTime = timestampSeconds - 60;
      const endTime = timestampSeconds + 60;

      const summaries = await stripe.billing.meters.listEventSummaries(config.meterId, {
        customer: testCustomerId,
        start_time: startTime,
        end_time: endTime,
      });

      expect(summaries.data).toBeDefined();
    });
  }
);
