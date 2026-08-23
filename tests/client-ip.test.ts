import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveClientIp, normalizeIp } from "@/lib/security/client-ip";
import { ApiError } from "@/lib/api/errors";

describe("Trusted Client-IP Resolution & Normalization", () => {
  const correlationId = "test-req-correlation-id";
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("IPv4 & IPv6 Normalization (normalizeIp)", () => {
    it("canonicalizes equivalent IPv6 representations to identical RFC 5952 format", () => {
      const full = "2001:0db8:0000:0000:0000:ff00:0042:8329";
      const compressed = "2001:db8::ff00:42:8329";
      const uppercase = "2001:DB8:0:0:0:FF00:42:8329";

      expect(normalizeIp(full)).toBe("2001:db8::ff00:42:8329");
      expect(normalizeIp(compressed)).toBe("2001:db8::ff00:42:8329");
      expect(normalizeIp(uppercase)).toBe("2001:db8::ff00:42:8329");
    });

    it("canonicalizes localhost ::1 and 0:0:0:0:0:0:0:1 identically", () => {
      expect(normalizeIp("::1")).toBe("::1");
      expect(normalizeIp("0:0:0:0:0:0:0:1")).toBe("::1");
      expect(normalizeIp("0000:0000:0000:0000:0000:0000:0000:0001")).toBe("::1");
    });

    it("canonicalizes unspecified :: address", () => {
      expect(normalizeIp("::")).toBe("::");
      expect(normalizeIp("0:0:0:0:0:0:0:0")).toBe("::");
    });

    it("canonicalizes IPv4 addresses without leading zeros", () => {
      expect(normalizeIp("192.0.2.1")).toBe("192.0.2.1");
      expect(normalizeIp(" 10.0.0.1 ")).toBe("10.0.0.1");
    });

    it("rejects malformed IPv4 and IPv6 strings", () => {
      expect(normalizeIp("192.0.2.300")).toBeNull();
      expect(normalizeIp("192.0.2")).toBeNull();
      expect(normalizeIp("192.0.2.1.5")).toBeNull();
      expect(normalizeIp("2001:db8:::1")).toBeNull(); // multiple double colons
      expect(normalizeIp("2001:xyz::1")).toBeNull(); // non-hex
      expect(normalizeIp("")).toBeNull();
      expect(normalizeIp("not-an-ip")).toBeNull();
    });
  });

  describe("Real Environment Variable Trust Derivation (VERCEL === '1')", () => {
    const setEnv = (nodeEnv?: string, vercelEnv?: string, vercel?: string) => {
      const env = process.env as Record<string, string | undefined>;
      if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
      else delete env.NODE_ENV;
      if (vercelEnv !== undefined) env.VERCEL_ENV = vercelEnv;
      else delete env.VERCEL_ENV;
      if (vercel !== undefined) env.VERCEL = vercel;
      else delete env.VERCEL;
    };

    it("permits trusted header when VERCEL='1' in production environment", () => {
      setEnv("production", undefined, "1");

      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195",
        },
      });

      const ip = resolveClientIp(request, correlationId);
      expect(ip).toBe("203.0.113.195");
    });

    it("permits trusted header when VERCEL_ENV='production' and VERCEL='1'", () => {
      setEnv("development", "production", "1");

      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "198.51.100.42",
        },
      });

      const ip = resolveClientIp(request, correlationId);
      expect(ip).toBe("198.51.100.42");
    });

    it("fails closed with 503 when VERCEL_ENV='production' but VERCEL is absent (does not infer trust from VERCEL_ENV)", () => {
      setEnv("development", "production", undefined);

      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195",
        },
      });

      expect(() => resolveClientIp(request, correlationId)).toThrow(ApiError);
      try {
        resolveClientIp(request, correlationId);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(503);
        expect((err as ApiError).code).toBe("RATE_LIMIT_UNAVAILABLE");
      }
    });

    it("fails closed with 503 when VERCEL_ENV='production' and VERCEL='0'", () => {
      setEnv("development", "production", "0");

      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195",
        },
      });

      expect(() => resolveClientIp(request, correlationId)).toThrow(ApiError);
    });

    it("fails closed with 503 when NODE_ENV='production' and VERCEL is absent", () => {
      setEnv("production", undefined, undefined);

      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195",
        },
      });

      expect(() => resolveClientIp(request, correlationId)).toThrow(ApiError);
    });

    it("never accepts spoofable fallback headers in production even if supplied", () => {
      setEnv("production", undefined, "1");

      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-forwarded-for": "1.2.3.4",
          "x-real-ip": "5.6.7.8",
          "cf-connecting-ip": "9.10.11.12",
        },
      });

      // x-vercel-forwarded-for is missing, so must fail closed
      expect(() => resolveClientIp(request, correlationId)).toThrow(ApiError);
    });
  });

  describe("Explicit Options Override", () => {
    it("resolves valid IPv4 from x-vercel-forwarded-for header in production on Vercel", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195",
        },
      });

      const ip = resolveClientIp(request, correlationId, { isProduction: true, isVercel: true });
      expect(ip).toBe("203.0.113.195");
    });

    it("resolves valid IPv6 and canonicalizes to RFC 5952 in production", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "2001:0DB8:85A3:0000:0000:8A2E:0370:7334",
        },
      });

      const ip = resolveClientIp(request, correlationId, { isProduction: true, isVercel: true });
      expect(ip).toBe("2001:db8:85a3::8a2e:370:7334");
    });

    it("parses first IP defensively from comma-separated proxy list", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "198.51.100.42, 10.0.0.1, 172.16.0.2",
        },
      });

      const ip = resolveClientIp(request, correlationId, { isProduction: true, isVercel: true });
      expect(ip).toBe("198.51.100.42");
    });

    it("fails closed with 503 when trusted header is completely missing in production", () => {
      const request = new Request("http://localhost/v1/images/transform");

      expect(() =>
        resolveClientIp(request, correlationId, { isProduction: true, isVercel: true })
      ).toThrow(ApiError);
    });

    it("fails closed when header contains invalid or non-IP text", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "not-an-ip-address",
        },
      });

      expect(() =>
        resolveClientIp(request, correlationId, { isProduction: true, isVercel: true })
      ).toThrow(ApiError);
    });

    it("fails closed when header is overlong (>128 chars)", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "1.1.1.1,".repeat(50),
        },
      });

      expect(() =>
        resolveClientIp(request, correlationId, { isProduction: true, isVercel: true })
      ).toThrow(ApiError);
    });

    it("fails closed with 503 outside Vercel in production", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-forwarded-for": "203.0.113.50",
          "x-real-ip": "203.0.113.50",
          "cf-connecting-ip": "203.0.113.50",
        },
      });

      expect(() =>
        resolveClientIp(request, correlationId, { isProduction: true, isVercel: false })
      ).toThrow(ApiError);
    });
  });

  describe("Development / Test Environment", () => {
    it("falls back to deterministic 127.0.0.1 when no headers are supplied in development", () => {
      const request = new Request("http://localhost/v1/images/transform");
      const ip = resolveClientIp(request, correlationId, { isProduction: false, isVercel: false });
      expect(ip).toBe("127.0.0.1");
    });

    it("accepts dev simulation headers in non-production", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-real-ip": "192.168.1.100",
        },
      });

      const ip = resolveClientIp(request, correlationId, { isProduction: false, isVercel: false });
      expect(ip).toBe("192.168.1.100");
    });
  });
});
