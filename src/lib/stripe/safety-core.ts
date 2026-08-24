import { DEFAULT_METER_EVENT_NAME } from "./config";

export interface ValidatedStripeConfig {
  stripeEnv: "test";
  secretKey: string;
  webhookSecret: string;
  meterId: string;
  meterEventName: string;
  meteredPriceId: string;
  cronSecret?: string;
}

const KNOWN_PLACEHOLDER_SUBSTRINGS = [
  "placeholder",
  "example",
  "your_stripe",
  "changeme",
  "xxx",
  "...",
];

function isKnownPlaceholder(val: string): boolean {
  const lower = val.toLowerCase();
  return KNOWN_PLACEHOLDER_SUBSTRINGS.some((ph) => lower.includes(ph));
}

/**
 * Pure environment safety validator for Stripe configuration.
 * Never leaks raw secrets or sensitive values into error messages.
 */
export function validateStripeEnv(
  env: Record<string, string | undefined>,
  options: {
    requireIntegrationTestOptIn?: boolean;
    allowOptionalWebhookSecret?: boolean;
  } = {}
): ValidatedStripeConfig {
  const stripeEnv = env.STRIPE_ENV;
  if (!stripeEnv) {
    throw new Error("Stripe Configuration Error: Missing required STRIPE_ENV variable.");
  }
  if (stripeEnv !== "test") {
    throw new Error("Stripe Safety Invariant: STRIPE_ENV must be strictly set to 'test'.");
  }

  // Check integration test environment guards if requested
  if (options.requireIntegrationTestOptIn) {
    if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
      throw new Error("Stripe Safety Invariant: Live Stripe integration tests are forbidden in production environments.");
    }
    if (env.RUN_STRIPE_INTEGRATION_TESTS !== "true") {
      throw new Error(
        "Stripe Safety Invariant: Live Stripe integration tests require explicit RUN_STRIPE_INTEGRATION_TESTS=true."
      );
    }
  }

  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe Configuration Error: Missing required STRIPE_SECRET_KEY variable.");
  }
  if (secretKey !== secretKey.trim()) {
    throw new Error("Stripe Security Error: STRIPE_SECRET_KEY contains forbidden leading/trailing whitespace.");
  }
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    throw new Error("Stripe Security Violation: Live credentials (sk_live_ / rk_live_) are strictly forbidden.");
  }
  if (!secretKey.startsWith("sk_test_") || secretKey.length < 24) {
    throw new Error("Stripe Configuration Error: STRIPE_SECRET_KEY must be a valid test-mode secret key starting with 'sk_test_'.");
  }
  if (isKnownPlaceholder(secretKey)) {
    throw new Error("Stripe Configuration Error: STRIPE_SECRET_KEY contains an unconfigured example placeholder.");
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  let finalWebhookSecret = "";
  if (!webhookSecret) {
    if (!options.allowOptionalWebhookSecret) {
      throw new Error("Stripe Configuration Error: Missing required STRIPE_WEBHOOK_SECRET variable.");
    }
  } else {
    if (webhookSecret !== webhookSecret.trim()) {
      throw new Error("Stripe Security Error: STRIPE_WEBHOOK_SECRET contains forbidden leading/trailing whitespace.");
    }
    if (isKnownPlaceholder(webhookSecret)) {
      if (!options.allowOptionalWebhookSecret) {
        throw new Error("Stripe Configuration Error: STRIPE_WEBHOOK_SECRET contains an unconfigured example placeholder.");
      }
    } else if (!webhookSecret.startsWith("whsec_") || webhookSecret.length < 16) {
      throw new Error("Stripe Configuration Error: STRIPE_WEBHOOK_SECRET must be a valid signing secret starting with 'whsec_'.");
    } else {
      finalWebhookSecret = webhookSecret;
    }
  }

  const meterId = env.STRIPE_METER_ID;
  if (!meterId) {
    throw new Error("Stripe Configuration Error: Missing required STRIPE_METER_ID variable.");
  }
  if (meterId !== meterId.trim()) {
    throw new Error("Stripe Security Error: STRIPE_METER_ID contains forbidden whitespace.");
  }
  if (!meterId.startsWith("mtr_") || meterId.length < 10) {
    throw new Error("Stripe Configuration Error: STRIPE_METER_ID must be a valid meter identifier starting with 'mtr_'.");
  }
  if (isKnownPlaceholder(meterId)) {
    throw new Error("Stripe Configuration Error: STRIPE_METER_ID contains an unconfigured example placeholder.");
  }

  const meteredPriceId = env.STRIPE_METERED_PRICE_ID;
  if (!meteredPriceId) {
    throw new Error("Stripe Configuration Error: Missing required STRIPE_METERED_PRICE_ID variable.");
  }
  if (meteredPriceId !== meteredPriceId.trim()) {
    throw new Error("Stripe Security Error: STRIPE_METERED_PRICE_ID contains forbidden whitespace.");
  }
  if (!meteredPriceId.startsWith("price_") || meteredPriceId.length < 10) {
    throw new Error("Stripe Configuration Error: STRIPE_METERED_PRICE_ID must be a valid price identifier starting with 'price_'.");
  }
  if (isKnownPlaceholder(meteredPriceId)) {
    throw new Error("Stripe Configuration Error: STRIPE_METERED_PRICE_ID contains an unconfigured example placeholder.");
  }

  const meterEventName = env.STRIPE_METER_EVENT_NAME?.trim() || DEFAULT_METER_EVENT_NAME;
  if (!/^[a-z0-9_-]{1,64}$/.test(meterEventName)) {
    throw new Error("Stripe Configuration Error: STRIPE_METER_EVENT_NAME must contain 1-64 alphanumeric, dash, or underscore characters.");
  }

  const cronSecret = env.CRON_SECRET;
  if (cronSecret !== undefined) {
    if (cronSecret !== cronSecret.trim()) {
      throw new Error("Stripe Security Error: CRON_SECRET contains forbidden leading/trailing whitespace.");
    }
    if (!/^[0-9a-f]{64}$/.test(cronSecret)) {
      throw new Error("Stripe Security Error: CRON_SECRET must be exactly 64 lowercase hexadecimal characters.");
    }
    if (cronSecret === "0".repeat(64)) {
      throw new Error("Stripe Security Error: CRON_SECRET is an insecure all-zero placeholder.");
    }
  }

  return {
    stripeEnv: "test",
    secretKey,
    webhookSecret: finalWebhookSecret,
    meterId,
    meterEventName,
    meteredPriceId,
    cronSecret,
  };
}

export interface StripeMeterObjectLike {
  id: string;
  livemode: boolean;
  event_name: string;
  status: string;
}

export interface StripePriceObjectLike {
  id: string;
  livemode: boolean;
  active: boolean;
  recurring?: {
    meter?: string | null;
    usage_type?: string;
  } | null;
}

/**
 * Validates retrieved Stripe Meter and Price objects against fail-closed requirements.
 */
export function validateStripeMeterAndPrice(
  meter: StripeMeterObjectLike,
  price: StripePriceObjectLike,
  expectedEventName: string
): void {
  if (meter.livemode !== false) {
    throw new Error("Stripe Safety Invariant: Configured Stripe Meter livemode must be false.");
  }
  if (meter.status !== "active") {
    throw new Error(`Stripe Configuration Error: Configured Stripe Meter '${meter.id}' is not in active status (status=${meter.status}).`);
  }
  if (meter.event_name !== expectedEventName) {
    throw new Error(
      `Stripe Configuration Error: Meter event_name '${meter.event_name}' does not match expected '${expectedEventName}'.`
    );
  }

  if (price.livemode !== false) {
    throw new Error("Stripe Safety Invariant: Configured Stripe Price livemode must be false.");
  }
  if (!price.active) {
    throw new Error(`Stripe Configuration Error: Configured Stripe Price '${price.id}' is inactive.`);
  }
  if (!price.recurring) {
    throw new Error(`Stripe Configuration Error: Configured Stripe Price '${price.id}' is not a recurring price.`);
  }

  const attachedMeter = price.recurring.meter;
  if (attachedMeter && attachedMeter !== meter.id) {
    throw new Error(
      `Stripe Configuration Error: Price '${price.id}' is attached to meter '${attachedMeter}', expected '${meter.id}'.`
    );
  }
}
