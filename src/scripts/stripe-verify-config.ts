import "./register-server-only";
import * as dotenv from "dotenv";
import { getValidatedStripeConfig, validateStripeMeterAndPrice } from "../lib/stripe/safety";
import { getStripeClient } from "../lib/stripe/client";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function main() {
  console.log("=== Verifying Stripe Configuration & Test Mode Safety ===");

  try {
    const config = getValidatedStripeConfig();
    console.log("✅ Environment configuration format and safety rules passed.");

    const stripe = getStripeClient();

    console.log("Retrieving configured Stripe Meter and Price objects...");
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

    console.log("✅ Configured Stripe Meter and Price verified successfully in test mode.");
  } catch (err) {
    console.error("❌ Stripe configuration verification failed:", (err as Error).message);
    process.exitCode = 1;
  }
}

main();
