import "server-only";
import Stripe from "stripe";
import { getValidatedStripeConfig } from "./safety";
import { STRIPE_API_VERSION } from "./config";

let cachedStripeClient: Stripe | null = null;

/**
 * Returns a lazily initialized Stripe client strictly validated against test-mode safety rules.
 * Does NOT instantiate at module load time to preserve safe Next.js build compilation.
 */
export function getStripeClient(): Stripe {
  if (cachedStripeClient) {
    return cachedStripeClient;
  }

  const config = getValidatedStripeConfig();

  cachedStripeClient = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 15000,
    maxNetworkRetries: 2,
    appInfo: {
      name: "Image-API",
      version: "1.0.0",
    },
  });

  return cachedStripeClient;
}
