import { describe, it, expect } from "vitest";
import { validateDevelopmentRedisSafety } from "@/lib/ratelimit/redis-safety-core";
import { validateRateLimitSecret, normalizeIp } from "@/lib/security/rate-limit-core";
import { validatePostgresUrlSecurity } from "@/db/ssl-validation";
import {
  createDocumentationIpv6,
  generateIsolatedE2EClientIps,
  buildE2ERequestHeaders,
  deriveE2ECleanupIdentifiers,
} from "@/lib/ratelimit/http-e2e-helper";

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

describe("HTTP E2E Client IP Isolation & Request Injection Helper Tests", () => {
  const validSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("generates valid IPv6 addresses adhering to documentation prefix 2001:db8::/32", () => {
    const rawIp = createDocumentationIpv6();
    expect(rawIp).toMatch(/^2001:db8(:[0-9a-f]{4}){6}$/);

    const normalized = normalizeIp(rawIp);
    expect(normalized).not.toBeNull();
    expect(normalized?.startsWith("2001:db8:")).toBe(true);
  });

  it("generates two distinct, non-identical canonical IPv6 addresses for ordinary and flood tests", () => {
    const { ordinaryClientIp, floodClientIp } = generateIsolatedE2EClientIps();

    expect(ordinaryClientIp).not.toBe(floodClientIp);
    expect(normalizeIp(ordinaryClientIp)).toBe(ordinaryClientIp);
    expect(normalizeIp(floodClientIp)).toBe(floodClientIp);
    expect(ordinaryClientIp).not.toBe("127.0.0.1");
    expect(floodClientIp).not.toBe("127.0.0.1");
  });

  it("builds E2E request headers injecting x-forwarded-for and preserving required properties", () => {
    const ordinaryIp = "2001:db8:1111:2222:3333:4444:5555:6666";
    const headers = buildE2ERequestHeaders({
      clientIp: ordinaryIp,
      authorization: "Bearer img_live_testkey123",
      idempotencyKey: "idemp-key-123",
      contentType: "multipart/form-data; boundary=----boundary123",
      contentLength: 1024,
    });

    expect(headers["x-forwarded-for"]).toBe(ordinaryIp);
    expect(headers["Authorization"]).toBe("Bearer img_live_testkey123");
    expect(headers["Idempotency-Key"]).toBe("idemp-key-123");
    expect(headers["Content-Type"]).toBe("multipart/form-data; boundary=----boundary123");
    expect(headers["Content-Length"]).toBe("1024");
  });

  it("prevents test-supplied customHeaders from overriding the isolated client IP", () => {
    const ordinaryIp = "2001:db8:1111:2222:3333:4444:5555:6666";
    const headers = buildE2ERequestHeaders({
      clientIp: ordinaryIp,
      customHeaders: {
        "x-forwarded-for": "1.2.3.4", // Malicious / accidental override
        "X-Custom-Header": "safe-value",
      },
    });

    expect(headers["x-forwarded-for"]).toBe(ordinaryIp);
    expect(headers["X-Custom-Header"]).toBe("safe-value");
  });

  it("derives exactly 3 distinct privacy-preserving cleanup identifiers", () => {
    const { ordinaryClientIp, floodClientIp } = generateIsolatedE2EClientIps();
    const cleanupIds = deriveE2ECleanupIdentifiers(
      "org-test-e2e",
      "key-test-e2e",
      ordinaryClientIp,
      floodClientIp,
      validSecret
    );

    expect(cleanupIds.keyIdentifier).toMatch(/^[0-9a-f]{64}$/);
    expect(cleanupIds.ordinaryIpIdentifier).toMatch(/^[0-9a-f]{64}$/);
    expect(cleanupIds.floodIpIdentifier).toMatch(/^[0-9a-f]{64}$/);

    // All 3 identifiers must be mutually distinct
    const uniqueIds = new Set([
      cleanupIds.keyIdentifier,
      cleanupIds.ordinaryIpIdentifier,
      cleanupIds.floodIpIdentifier,
    ]);
    expect(uniqueIds.size).toBe(3);
  });
});
