import { describe, it, expect, vi } from "vitest";
import {
  checkIpRateLimit,
  checkApiKeyRateLimit,
  validateRateLimitResponse,
  getValidatedTimeout,
} from "@/lib/ratelimit/limiter";
import { buildRateLimitHeaders } from "@/lib/ratelimit/headers";
import { ApiError, createErrorResponse, sanitizeErrorHeaders } from "@/lib/api/errors";
import type { Ratelimit } from "@upstash/ratelimit";

describe("Distributed Rate Limiting Unit Tests (Fail-Closed & Header Contracts)", () => {
  const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const correlationId = "corr-test-12345";
  const now = 1724400000000; // Fixed timestamp ms

  const createMockLimiter = (response: unknown): Ratelimit =>
    ({
      limit: vi.fn().mockResolvedValue(response),
    } as unknown as Ratelimit);

  describe("Pure Validator (validateRateLimitResponse)", () => {
    it("accepts valid Upstash response structure with undefined reason", () => {
      const res = validateRateLimitResponse({
        success: true,
        limit: 120,
        remaining: 115,
        reset: now + 30000,
      }, now);

      expect(res).toEqual({
        success: true,
        limit: 120,
        remaining: 115,
        reset: now + 30000,
        retryAfterSeconds: 30,
      });
    });

    it("accepts valid cacheBlock reason only when success is false", () => {
      const res = validateRateLimitResponse({
        success: false,
        limit: 20,
        remaining: 0,
        reset: now + 10000,
        reason: "cacheBlock",
      }, now);

      expect(res).not.toBeNull();
      expect(res?.success).toBe(false);
    });

    it("rejects cacheBlock reason when success is true", () => {
      const res = validateRateLimitResponse({
        success: true,
        limit: 20,
        remaining: 10,
        reset: now + 10000,
        reason: "cacheBlock",
      }, now);

      expect(res).toBeNull();
    });

    it("rejects timeout reason", () => {
      const res = validateRateLimitResponse({
        success: true,
        limit: 120,
        remaining: 120,
        reset: now + 60000,
        reason: "timeout",
      }, now);

      expect(res).toBeNull();
    });

    it("rejects reason: 'cache'", () => {
      expect(
        validateRateLimitResponse({
          success: true,
          limit: 120,
          remaining: 100,
          reset: now + 10000,
          reason: "cache",
        }, now)
      ).toBeNull();
    });

    it("rejects reason: null", () => {
      expect(
        validateRateLimitResponse({
          success: true,
          limit: 120,
          remaining: 100,
          reset: now + 10000,
          reason: null,
        }, now)
      ).toBeNull();
    });

    it("rejects reason: empty string ''", () => {
      expect(
        validateRateLimitResponse({
          success: true,
          limit: 120,
          remaining: 100,
          reset: now + 10000,
          reason: "",
        }, now)
      ).toBeNull();
    });

    it("rejects reason: 'denyList'", () => {
      expect(
        validateRateLimitResponse({
          success: false,
          limit: 120,
          remaining: 0,
          reset: now + 10000,
          reason: "denyList",
        }, now)
      ).toBeNull();
    });

    it("rejects arbitrary unknown reason strings", () => {
      const res = validateRateLimitResponse({
        success: false,
        limit: 120,
        remaining: 0,
        reset: now + 60000,
        reason: "malicious_unrecognized_reason",
      }, now);

      expect(res).toBeNull();
    });

    it("rejects non-boolean success", () => {
      expect(validateRateLimitResponse({ success: "true", limit: 10, remaining: 5, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: 1, limit: 10, remaining: 5, reset: now + 1000 }, now)).toBeNull();
    });

    it("rejects invalid limit (NaN, Infinity, <=0, non-integer, fractional)", () => {
      expect(validateRateLimitResponse({ success: true, limit: NaN, remaining: 0, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: Infinity, remaining: 0, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 0, remaining: 0, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: -5, remaining: 0, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10.5, remaining: 5, reset: now + 1000 }, now)).toBeNull();
    });

    it("rejects invalid remaining (negative, greater than limit, non-integer, NaN, Infinity, fractional)", () => {
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: -1, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 15, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 5.5, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: NaN, reset: now + 1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: Infinity, reset: now + 1000 }, now)).toBeNull();
    });

    it("rejects invalid reset timestamps (<=0, NaN, Infinity, fractional)", () => {
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 5, reset: 0 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 5, reset: -1000 }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 5, reset: NaN }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 5, reset: Infinity }, now)).toBeNull();
      expect(validateRateLimitResponse({ success: true, limit: 10, remaining: 5, reset: now + 1000.5 }, now)).toBeNull();
    });
  });

  describe("Timeout Bounds (getValidatedTimeout)", () => {
    it("returns default timeout when undefined", () => {
      expect(getValidatedTimeout()).toBe(4000); // Test runner default
      expect(getValidatedTimeout(undefined, false)).toBe(2500); // Production default
    });

    it("accepts valid explicit timeout within [500, 5000]", () => {
      expect(getValidatedTimeout(1500)).toBe(1500);
      expect(getValidatedTimeout(3000)).toBe(3000);
    });

    it("falls back to default when explicit timeout is out of bounds", () => {
      expect(getValidatedTimeout(100)).toBe(4000);
      expect(getValidatedTimeout(100, false)).toBe(2500);
      expect(getValidatedTimeout(100000)).toBe(4000);
      expect(getValidatedTimeout(NaN)).toBe(4000);
    });
  });

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

    it("converts malformed Upstash response to fail-closed 503 RATE_LIMIT_UNAVAILABLE", async () => {
      const mockLimiter = createMockLimiter({
        success: true,
        limit: "120", // String instead of number
        remaining: -5,
        reset: "invalid",
      });

      await expect(
        checkIpRateLimit("203.0.113.195", correlationId, { secret, ipLimiter: mockLimiter })
      ).rejects.toMatchObject({
        statusCode: 503,
        code: "RATE_LIMIT_UNAVAILABLE",
      });
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

  describe("Error Response Header Allowlist & Security Header Protection", () => {
    it("sanitizes rate-limit headers to non-negative integer values", () => {
      const safe = sanitizeErrorHeaders({
        "Retry-After": "30",
        "X-RateLimit-Limit": "120",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "1724400030",
        "X-Injected-Header": "malicious",
        "Content-Type": "text/html",
      });

      expect(safe).toEqual({
        "Retry-After": "30",
        "X-RateLimit-Limit": "120",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": "1724400030",
      });
    });

    it("rejects non-integer / NaN / negative header values", () => {
      const safe = sanitizeErrorHeaders({
        "Retry-After": "NaN",
        "X-RateLimit-Limit": "-5",
        "X-RateLimit-Remaining": "3.14",
        "X-RateLimit-Reset": "Infinity",
      });

      expect(safe).toEqual({});
    });

    it("prevents ApiError from overriding Content-Type, Cache-Control, X-Content-Type-Options, or X-Request-ID", () => {
      const maliciousError = new ApiError(
        429,
        "RATE_LIMITED",
        "Rate limit exceeded",
        "legitimate-req-id",
        {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "allow-sniffing",
          "X-Request-ID": "spoofed-request-id",
          "Retry-After": "10",
        }
      );

      const response = createErrorResponse(maliciousError, "legitimate-req-id");
      expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Request-ID")).toBe("legitimate-req-id");
      expect(response.headers.get("Retry-After")).toBe("10");
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
