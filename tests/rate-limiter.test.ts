import { describe, it, expect, vi } from "vitest";
import {
  checkIpRateLimit,
  checkApiKeyRateLimit,
} from "@/lib/ratelimit/limiter";
import { buildRateLimitHeaders } from "@/lib/ratelimit/headers";
import { ApiError } from "@/lib/api/errors";
import type { Ratelimit } from "@upstash/ratelimit";

describe("Distributed Rate Limiting Unit Tests (Fail-Closed & Header Contracts)", () => {
  const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const correlationId = "corr-test-12345";
  const now = 1724400000000; // Fixed timestamp ms

  const createMockLimiter = (response: {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    reason?: string;
  }): Ratelimit =>
    ({
      limit: vi.fn().mockResolvedValue(response),
    } as unknown as Ratelimit);

  describe("IP Rate Limiting", () => {
    it("returns allowed decision with correct quota metadata", async () => {
      const mockLimiter = createMockLimiter({
        success: true,
        limit: 120,
        remaining: 119,
        reset: now + 45000,
      });

      const decision = await checkIpRateLimit("203.0.113.195", correlationId, {
        secret,
        ipLimiter: mockLimiter,
      });

      expect(decision.success).toBe(true);
      expect(decision.limit).toBe(120);
      expect(decision.remaining).toBe(119);
      expect(decision.reset).toBe(now + 45000);
      expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it("throws 429 RATE_LIMITED with exact response headers when IP quota is exhausted", async () => {
      const resetTime = now + 15200;
      const mockLimiter = createMockLimiter({
        success: false,
        limit: 120,
        remaining: 0,
        reset: resetTime,
      });

      try {
        await checkIpRateLimit("203.0.113.195", correlationId, {
          secret,
          ipLimiter: mockLimiter,
        });
        expect.unreachable("Should have thrown 429 ApiError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.statusCode).toBe(429);
        expect(apiErr.code).toBe("RATE_LIMITED");
        expect(apiErr.message).toBe("Too many requests. Please retry later.");
        expect(apiErr.headers).toBeDefined();
        expect(apiErr.headers?.["Retry-After"]).toBeDefined();
        expect(Number(apiErr.headers?.["Retry-After"])).toBeGreaterThanOrEqual(1);
        expect(apiErr.headers?.["X-RateLimit-Limit"]).toBe("120");
        expect(apiErr.headers?.["X-RateLimit-Remaining"]).toBe("0");
        expect(apiErr.headers?.["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetTime / 1000)));
      }
    });

    it("converts Upstash reason='timeout' to fail-closed 503 RATE_LIMIT_UNAVAILABLE", async () => {
      const mockLimiter = createMockLimiter({
        success: true, // Upstash defaults success to true on timeout
        limit: 120,
        remaining: 120,
        reset: now + 60000,
        reason: "timeout",
      });

      try {
        await checkIpRateLimit("203.0.113.195", correlationId, {
          secret,
          ipLimiter: mockLimiter,
        });
        expect.unreachable("Should have thrown 503 ApiError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.statusCode).toBe(503);
        expect(apiErr.code).toBe("RATE_LIMIT_UNAVAILABLE");
      }
    });

    it("converts Redis network / runtime exception to fail-closed 503 RATE_LIMIT_UNAVAILABLE", async () => {
      const mockLimiter = {
        limit: vi.fn().mockRejectedValue(new Error("Redis connection refused")),
      } as unknown as Ratelimit;

      try {
        await checkIpRateLimit("203.0.113.195", correlationId, {
          secret,
          ipLimiter: mockLimiter,
        });
        expect.unreachable("Should have thrown 503 ApiError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.statusCode).toBe(503);
        expect(apiErr.code).toBe("RATE_LIMIT_UNAVAILABLE");
      }
    });
  });

  describe("API-Key Rate Limiting", () => {
    it("returns allowed decision for authenticated key within token bucket quota", async () => {
      const mockLimiter = createMockLimiter({
        success: true,
        limit: 20,
        remaining: 19,
        reset: now + 10000,
      });

      const decision = await checkApiKeyRateLimit(
        "org-tenant-123",
        "550e8400-e29b-41d4-a716-446655440000",
        correlationId,
        { secret, keyLimiter: mockLimiter }
      );

      expect(decision.success).toBe(true);
      expect(decision.limit).toBe(20);
      expect(decision.remaining).toBe(19);
      expect(decision.reset).toBe(now + 10000);
    });

    it("throws 429 RATE_LIMITED when API key token bucket is exhausted", async () => {
      const resetTime = now + 8500;
      const mockLimiter = createMockLimiter({
        success: false,
        limit: 20,
        remaining: 0,
        reset: resetTime,
      });

      try {
        await checkApiKeyRateLimit(
          "org-tenant-123",
          "550e8400-e29b-41d4-a716-446655440000",
          correlationId,
          { secret, keyLimiter: mockLimiter }
        );
        expect.unreachable("Should have thrown 429 ApiError");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.statusCode).toBe(429);
        expect(apiErr.code).toBe("RATE_LIMITED");
        expect(apiErr.headers?.["X-RateLimit-Limit"]).toBe("20");
        expect(apiErr.headers?.["X-RateLimit-Remaining"]).toBe("0");
        expect(apiErr.headers?.["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetTime / 1000)));
      }
    });

    it("converts Upstash reason='timeout' on key limiter to fail-closed 503", async () => {
      const mockLimiter = createMockLimiter({
        success: true,
        limit: 20,
        remaining: 20,
        reset: now + 10000,
        reason: "timeout",
      });

      await expect(
        checkApiKeyRateLimit("org-1", "key-1", correlationId, { secret, keyLimiter: mockLimiter })
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "RATE_LIMIT_UNAVAILABLE",
      });
    });
  });

  describe("buildRateLimitHeaders Helper", () => {
    it("formats rate limit headers correctly for 200 response", () => {
      const headers = buildRateLimitHeaders({
        success: true,
        limit: 20,
        remaining: 18,
        reset: 1724400010000,
        retryAfterSeconds: 10,
      });

      expect(headers).toEqual({
        "X-RateLimit-Limit": "20",
        "X-RateLimit-Remaining": "18",
        "X-RateLimit-Reset": "1724400010",
      });
    });
  });
});
