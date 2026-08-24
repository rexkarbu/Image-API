import "server-only";
import {
  validateStripeEnv,
  validateStripeMeterAndPrice,
  ValidatedStripeConfig,
  StripeMeterObjectLike,
  StripePriceObjectLike,
} from "./safety-core";

export { validateStripeEnv, validateStripeMeterAndPrice };
export type { ValidatedStripeConfig, StripeMeterObjectLike, StripePriceObjectLike };

/**
 * Server-only helper to validate Stripe environment variables in active process.
 */
export function getValidatedStripeConfig(options?: {
  requireIntegrationTestOptIn?: boolean;
  allowOptionalWebhookSecret?: boolean;
}): ValidatedStripeConfig {
  return validateStripeEnv(process.env, options);
}
