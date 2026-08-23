import { describe, it, expect } from "vitest";
import {
  extractUpstashEndpointId,
  validateDevelopmentRedisSafety,
  RedisSafetyEnv,
} from "@/lib/ratelimit/redis-safety";

describe("Redis Safety Guard (Pure Unit Tests)", () => {
  const validEndpointId = "us1-example-test-12345";
  const validRestUrl = `https://${validEndpointId}.upstash.io`;
  const validToken = "AXY1234567890ABCDEFTOKEN";

  const createValidEnv = (): RedisSafetyEnv => ({
    NODE_ENV: "development",
    VERCEL_ENV: "development",
    REDIS_ENV: "development",
    RUN_REDIS_INTEGRATION_TESTS: "true",
    UPSTASH_REDIS_REST_URL: validRestUrl,
    UPSTASH_REDIS_REST_TOKEN: validToken,
    DEVELOPMENT_REDIS_ENDPOINT_ID: validEndpointId,
    RATE_LIMIT_IDENTIFIER_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });

  describe("extractUpstashEndpointId", () => {
    it("extracts endpoint ID correctly from valid Upstash host", () => {
      const res = extractUpstashEndpointId("us1-swift-falcon-12345.upstash.io");
      expect(res).toEqual({
        endpointId: "us1-swift-falcon-12345",
        isValidUpstashHost: true,
      });
    });

    it("rejects non-upstash hostnames", () => {
      const res = extractUpstashEndpointId("redis.mycompany.com");
      expect(res.isValidUpstashHost).toBe(false);
      expect(res.endpointId).toBe("");
    });
  });

  describe("validateDevelopmentRedisSafety (Positive)", () => {
    it("passes when all parameters strictly match development safety invariants", () => {
      const env = createValidEnv();
      const res = validateDevelopmentRedisSafety(env);
      expect(res.isDevelopmentVerified).toBe(true);
      expect(res.endpointId).toBe(validEndpointId);
    });
  });

  describe("validateDevelopmentRedisSafety (Negative / Fail-Closed)", () => {
    it("rejects when RUN_REDIS_INTEGRATION_TESTS is not 'true'", () => {
      const env = createValidEnv();
      delete env.RUN_REDIS_INTEGRATION_TESTS;
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(/RUN_REDIS_INTEGRATION_TESTS=true/);

      env.RUN_REDIS_INTEGRATION_TESTS = "false";
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(/RUN_REDIS_INTEGRATION_TESTS=true/);
    });

    it("rejects when REDIS_ENV is not 'development'", () => {
      const env = createValidEnv();
      env.REDIS_ENV = "production";
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(/REDIS_ENV='development'/);
    });

    it("rejects when NODE_ENV or VERCEL_ENV is 'production'", () => {
      const env1 = createValidEnv();
      env1.NODE_ENV = "production";
      expect(() => validateDevelopmentRedisSafety(env1)).toThrow(/production environment/);

      const env2 = createValidEnv();
      env2.VERCEL_ENV = "production";
      expect(() => validateDevelopmentRedisSafety(env2)).toThrow(/production environment/);
    });

    it("rejects when UPSTASH_REDIS_REST_URL is missing or non-https", () => {
      const env = createValidEnv();
      delete env.UPSTASH_REDIS_REST_URL;
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(/UPSTASH_REDIS_REST_URL is missing/);

      env.UPSTASH_REDIS_REST_URL = `http://${validEndpointId}.upstash.io`;
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(/must be https:/);
    });

    it("rejects when UPSTASH_REDIS_REST_TOKEN is missing", () => {
      const env = createValidEnv();
      delete env.UPSTASH_REDIS_REST_TOKEN;
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(/UPSTASH_REDIS_REST_TOKEN is missing/);
    });

    it("rejects when endpoint ID does not match pinned DEVELOPMENT_REDIS_ENDPOINT_ID", () => {
      const env = createValidEnv();
      env.UPSTASH_REDIS_REST_URL = "https://us1-other-endpoint.upstash.io";
      expect(() => validateDevelopmentRedisSafety(env)).toThrow(
        /does not match pinned DEVELOPMENT_REDIS_ENDPOINT_ID/
      );
    });

    it("never includes token or sensitive credentials in error messages", () => {
      const sensitiveToken = "SUPER_SECRET_UPSTASH_REST_TOKEN_12345";
      const env = createValidEnv();
      env.UPSTASH_REDIS_REST_TOKEN = sensitiveToken;
      env.UPSTASH_REDIS_REST_URL = "https://unmatched-endpoint.upstash.io";

      try {
        validateDevelopmentRedisSafety(env);
        expect.unreachable("Should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).not.toContain(sensitiveToken);
      }
    });
  });
});
