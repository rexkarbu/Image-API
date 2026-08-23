import { describe, it, expect } from "vitest";
import { validateDevelopmentRedisSafety } from "@/lib/ratelimit/redis-safety-core";
import { validateRateLimitSecret } from "@/lib/security/rate-limit-core";
import { validatePostgresUrlSecurity } from "@/db/ssl-validation";

describe("HTTP E2E Safety Preflight Guard Assertions", () => {
  const validSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const validEndpointId = "us1-example-test-12345";
  const validRestUrl = `https://${validEndpointId}.upstash.io`;
  const validToken = "AXY1234567890ABCDEFTOKEN";

  const createBaseEnv = () => ({
    NODE_ENV: "development",
    VERCEL_ENV: "development",
    REDIS_ENV: "development",
    RUN_REDIS_INTEGRATION_TESTS: "true",
    UPSTASH_REDIS_REST_URL: validRestUrl,
    UPSTASH_REDIS_REST_TOKEN: validToken,
    DEVELOPMENT_REDIS_ENDPOINT_ID: validEndpointId,
    RATE_LIMIT_IDENTIFIER_SECRET: validSecret,
  });

  it("refuses production Redis environment (NODE_ENV=production)", () => {
    const env = createBaseEnv();
    env.NODE_ENV = "production";
    expect(() => validateDevelopmentRedisSafety(env)).toThrow(/production environment/);
  });

  it("refuses production Redis environment (VERCEL_ENV=production)", () => {
    const env = createBaseEnv();
    env.VERCEL_ENV = "production";
    expect(() => validateDevelopmentRedisSafety(env)).toThrow(/production environment/);
  });

  it("refuses non-development REDIS_ENV", () => {
    const env = createBaseEnv();
    env.REDIS_ENV = "staging";
    expect(() => validateDevelopmentRedisSafety(env)).toThrow(/REDIS_ENV='development'/);
  });

  it("refuses missing Redis integration test opt-in (RUN_REDIS_INTEGRATION_TESTS)", () => {
    const env = createBaseEnv();
    env.RUN_REDIS_INTEGRATION_TESTS = "false";
    expect(() => validateDevelopmentRedisSafety(env)).toThrow(/RUN_REDIS_INTEGRATION_TESTS=true/);
  });

  it("refuses mismatched Upstash endpoint ID", () => {
    const env = createBaseEnv();
    env.UPSTASH_REDIS_REST_URL = "https://us1-malicious-target.upstash.io";
    expect(() => validateDevelopmentRedisSafety(env)).toThrow(/does not match pinned DEVELOPMENT_REDIS_ENDPOINT_ID/);
  });

  it("refuses weak or whitespace-padded rate limit secrets", () => {
    expect(() => validateRateLimitSecret(` ${validSecret} `)).toThrow(/must be exactly 64 lowercase hexadecimal/);
    expect(() => validateRateLimitSecret("too-short")).toThrow(/must be exactly 64 lowercase hexadecimal/);
    expect(() => validateRateLimitSecret("0".repeat(64))).toThrow(/all-zero placeholder/);
  });

  it("refuses insecure PostgreSQL connection URLs (sslmode missing verify-full)", () => {
    expect(() =>
      validatePostgresUrlSecurity(
        "postgres://user:pass@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
        "DATABASE_URL"
      )
    ).toThrow(/sslmode=verify-full/);
  });
});
