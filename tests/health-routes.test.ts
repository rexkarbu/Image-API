import { describe, it, expect, vi } from "vitest";
import { GET as getHealthLive } from "@/app/api/health/live/route";
import {
  verifyHealthAuth,
  checkDatabaseReadiness,
  checkRedisReadiness,
  evaluateReadiness,
} from "@/lib/health/readiness-core";

describe("Health Check Routes & Readiness Safety Unit Tests", () => {
  describe("GET /api/health/live", () => {
    it("returns HTTP 200 with minimal status and security headers", async () => {
      const request = new Request("http://localhost:3000/api/health/live", {
        headers: {
          "X-Request-ID": "custom-probe-id-12345",
        },
      });

      const response = await getHealthLive(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-request-id")).toBe("custom-probe-id-12345");

      const body = await response.json();
      expect(body).toEqual({
        status: "ok",
        service: "image-api",
      });
    });

    it("generates a valid X-Request-ID when omitted from request", async () => {
      const request = new Request("http://localhost:3000/api/health/live");
      const response = await getHealthLive(request);

      expect(response.status).toBe(200);
      const reqId = response.headers.get("x-request-id");
      expect(reqId).toBeDefined();
      expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe("Readiness Core & Dependency Evaluation", () => {
    it("returns healthy when database returns exact ready === 1 row", async () => {
      const mockQuery = vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] });
      const isHealthy = await checkDatabaseReadiness(mockQuery);
      expect(isHealthy).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("returns unhealthy on database rejection or exception", async () => {
      const mockQuery = vi.fn().mockRejectedValue(new Error("Connection refused"));
      const isHealthy = await checkDatabaseReadiness(mockQuery);
      expect(isHealthy).toBe(false);
    });

    it("returns unhealthy on database query timeout", async () => {
      const slowQuery = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [{ ready: 1 }] }), 100))
      );
      const isHealthy = await checkDatabaseReadiness(slowQuery, 20); // 20ms timeout
      expect(isHealthy).toBe(false);
    });

    it("returns unhealthy on malformed database rows (empty rows or wrong value)", async () => {
      const emptyQuery = vi.fn().mockResolvedValue({ rows: [] });
      expect(await checkDatabaseReadiness(emptyQuery)).toBe(false);

      const wrongValQuery = vi.fn().mockResolvedValue({ rows: [{ ready: 2 }] });
      expect(await checkDatabaseReadiness(wrongValQuery)).toBe(false);

      const noRowsQuery = vi.fn().mockResolvedValue({});
      expect(await checkDatabaseReadiness(noRowsQuery)).toBe(false);
    });

    it("returns healthy when Redis returns exact 'PONG'", async () => {
      const mockPing = vi.fn().mockResolvedValue("PONG");
      const isHealthy = await checkRedisReadiness(mockPing);
      expect(isHealthy).toBe(true);
      expect(mockPing).toHaveBeenCalledTimes(1);
    });

    it("returns unhealthy on Redis ping rejection or exception", async () => {
      const mockPing = vi.fn().mockRejectedValue(new Error("Redis timeout"));
      const isHealthy = await checkRedisReadiness(mockPing);
      expect(isHealthy).toBe(false);
    });

    it("returns unhealthy on Redis ping timeout", async () => {
      const slowPing = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve("PONG"), 100))
      );
      const isHealthy = await checkRedisReadiness(slowPing, 20); // 20ms timeout
      expect(isHealthy).toBe(false);
    });

    it("returns unhealthy on malformed Redis return value", async () => {
      const badPing1 = vi.fn().mockResolvedValue("OK");
      expect(await checkRedisReadiness(badPing1)).toBe(false);

      const badPing2 = vi.fn().mockResolvedValue(null);
      expect(await checkRedisReadiness(badPing2)).toBe(false);

      const badPing3 = vi.fn().mockResolvedValue({ status: "PONG" });
      expect(await checkRedisReadiness(badPing3)).toBe(false);
    });

    it("evaluates both dependencies in parallel and aggregates status correctly", async () => {
      const healthyDeps = {
        queryDatabase: vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] }),
        pingRedis: vi.fn().mockResolvedValue("PONG"),
      };
      const res1 = await evaluateReadiness(healthyDeps);
      expect(res1.allHealthy).toBe(true);
      expect(res1.database).toBe("healthy");
      expect(res1.redis).toBe("healthy");

      const degradedDeps = {
        queryDatabase: vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] }),
        pingRedis: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
      };
      const res2 = await evaluateReadiness(degradedDeps);
      expect(res2.allHealthy).toBe(false);
      expect(res2.database).toBe("healthy");
      expect(res2.redis).toBe("unhealthy");
    });
  });

  describe("Production Health Authorization Verification", () => {
    const validSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    it("permits unauthenticated checks in non-production environments", () => {
      expect(verifyHealthAuth(null, false, undefined)).toBe(true);
      expect(verifyHealthAuth("Bearer invalid", false, undefined)).toBe(true);
    });

    it("rejects unauthorized requests in production when secret is missing or invalid", () => {
      expect(verifyHealthAuth(null, true, validSecret)).toBe(false);
      expect(verifyHealthAuth("Bearer wrong_secret", true, validSecret)).toBe(false);
      expect(verifyHealthAuth("Bearer short", true, validSecret)).toBe(false);
      expect(verifyHealthAuth(`Bearer ${validSecret}`, true, undefined)).toBe(false); // unconfigured secret fails closed
    });

    it("authorizes valid secret in production with constant-time match", () => {
      expect(verifyHealthAuth(`Bearer ${validSecret}`, true, validSecret)).toBe(true);
    });
  });
});
