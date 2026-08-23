import { describe, it, expect } from "vitest";
import { resolveClientIp } from "@/lib/security/client-ip";
import { ApiError } from "@/lib/api/errors";

describe("Trusted Client-IP Resolution", () => {
  const correlationId = "test-req-correlation-id";

  describe("Production Environment", () => {
    it("resolves valid IPv4 from x-vercel-forwarded-for header in production on Vercel", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195",
        },
      });

      const ip = resolveClientIp(request, correlationId, { isProduction: true, isVercel: true });
      expect(ip).toBe("203.0.113.195");
    });

    it("resolves valid IPv6 and normalizes to lowercase in production", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-vercel-forwarded-for": "2001:0DB8:85A3:0000:0000:8A2E:0370:7334",
        },
      });

      const ip = resolveClientIp(request, correlationId, { isProduction: true, isVercel: true });
      expect(ip).toBe("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
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

    it("rejects caller-controlled x-forwarded-for when on Vercel in production", () => {
      const request = new Request("http://localhost/v1/images/transform", {
        headers: {
          "x-forwarded-for": "1.2.3.4",
          // x-vercel-forwarded-for is missing
        },
      });

      expect(() =>
        resolveClientIp(request, correlationId, { isProduction: true, isVercel: true })
      ).toThrow(ApiError);

      try {
        resolveClientIp(request, correlationId, { isProduction: true, isVercel: true });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.statusCode).toBe(503);
        expect(apiErr.code).toBe("RATE_LIMIT_UNAVAILABLE");
      }
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
