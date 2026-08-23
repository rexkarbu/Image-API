import { describe, it, expect } from "vitest";
import {
  validateStripeEnv,
  validateStripeMeterAndPrice,
} from "@/lib/stripe/safety-core";

describe("Stripe Environment & Safety Validation Assertions", () => {
  const validSecret = "sk_test_51234567890abcdefghijklmnopqrstuvwxyz";
  const validWhsec = "whsec_0123456789abcdefghijklmnopqrstuvwxyz";
  const validMeter = "mtr_test_1234567890";
  const validPrice = "price_1234567890abcdef";
  const validCron = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const createBaseEnv = () => ({
    STRIPE_ENV: "test",
    STRIPE_SECRET_KEY: validSecret,
    STRIPE_WEBHOOK_SECRET: validWhsec,
    STRIPE_METER_ID: validMeter,
    STRIPE_METERED_PRICE_ID: validPrice,
    STRIPE_METER_EVENT_NAME: "image_transform",
    CRON_SECRET: validCron,
  });

  it("accepts valid test mode configuration", () => {
    const env = createBaseEnv();
    const config = validateStripeEnv(env);
    expect(config.stripeEnv).toBe("test");
    expect(config.secretKey).toBe(validSecret);
    expect(config.meterEventName).toBe("image_transform");
  });

  it("refuses missing or non-test STRIPE_ENV", () => {
    const env = createBaseEnv();
    delete (env as any).STRIPE_ENV;
    expect(() => validateStripeEnv(env)).toThrow(/Missing required STRIPE_ENV/);

    env.STRIPE_ENV = "production";
    expect(() => validateStripeEnv(env)).toThrow(/strictly set to 'test'/);
  });

  it("refuses live secret keys (sk_live_ / rk_live_)", () => {
    const env = createBaseEnv();
    env.STRIPE_SECRET_KEY = ["sk", "live", "mockkey12345678901234567890"].join("_");
    expect(() => validateStripeEnv(env)).toThrow(/Live credentials/);

    env.STRIPE_SECRET_KEY = ["rk", "live", "mockkey12345678901234567890"].join("_");
    expect(() => validateStripeEnv(env)).toThrow(/Live credentials/);
  });

  it("refuses whitespace padded credentials", () => {
    const env = createBaseEnv();
    env.STRIPE_SECRET_KEY = ` ${validSecret} `;
    expect(() => validateStripeEnv(env)).toThrow(/whitespace/);

    env.STRIPE_SECRET_KEY = validSecret;
    env.STRIPE_WEBHOOK_SECRET = `${validWhsec} `;
    expect(() => validateStripeEnv(env)).toThrow(/whitespace/);
  });

  it("refuses placeholder example values", () => {
    const env = createBaseEnv();
    env.STRIPE_SECRET_KEY = "sk_test_placeholder_1234567890";
    expect(() => validateStripeEnv(env)).toThrow(/unconfigured example placeholder/);

    env.STRIPE_SECRET_KEY = validSecret;
    env.STRIPE_WEBHOOK_SECRET = "whsec_example_secret_123456";
    expect(() => validateStripeEnv(env)).toThrow(/unconfigured example placeholder/);
  });

  it("refuses malformed or placeholder CRON_SECRET", () => {
    const env = createBaseEnv();
    env.CRON_SECRET = "short";
    expect(() => validateStripeEnv(env)).toThrow(/must be exactly 64 lowercase hexadecimal/);

    env.CRON_SECRET = "0".repeat(64);
    expect(() => validateStripeEnv(env)).toThrow(/all-zero placeholder/);
  });

  it("enforces integration test opt-in and guards against production", () => {
    const env = createBaseEnv();
    (env as any).RUN_STRIPE_INTEGRATION_TESTS = "false";
    expect(() =>
      validateStripeEnv(env, { requireIntegrationTestOptIn: true })
    ).toThrow(/RUN_STRIPE_INTEGRATION_TESTS=true/);

    (env as any).RUN_STRIPE_INTEGRATION_TESTS = "true";
    (env as any).NODE_ENV = "production";
    expect(() =>
      validateStripeEnv(env, { requireIntegrationTestOptIn: true })
    ).toThrow(/forbidden in production/);
  });

  it("validates Stripe Meter and Price objects accurately", () => {
    const validMeterObj = {
      id: "mtr_123",
      livemode: false,
      event_name: "image_transform",
      status: "active",
    };
    const validPriceObj = {
      id: "price_123",
      livemode: false,
      active: true,
      recurring: {
        meter: "mtr_123",
        usage_type: "metered",
      },
    };

    expect(() =>
      validateStripeMeterAndPrice(validMeterObj, validPriceObj, "image_transform")
    ).not.toThrow();

    // Rejects livemode meter
    expect(() =>
      validateStripeMeterAndPrice(
        { ...validMeterObj, livemode: true },
        validPriceObj,
        "image_transform"
      )
    ).toThrow(/livemode must be false/);

    // Rejects inactive price
    expect(() =>
      validateStripeMeterAndPrice(
        validMeterObj,
        { ...validPriceObj, active: false },
        "image_transform"
      )
    ).toThrow(/inactive/);

    // Rejects event name mismatch
    expect(() =>
      validateStripeMeterAndPrice(
        validMeterObj,
        validPriceObj,
        "different_event"
      )
    ).toThrow(/does not match expected/);
  });
});
