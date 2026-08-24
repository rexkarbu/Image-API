import { describe, it, expect, vi } from "vitest";
import { GET as getHealthLive } from "@/app/api/health/live/route";
import { GET as getHealthReady } from "@/app/api/health/ready/route";
import {
  verifyHealthAuth,
  executeBoundedDatabaseCheck,
  executeBoundedRedisCheck,
  evaluateReadiness,
} from "@/lib/health/readiness-core";

describe("Health Check Routes & Bounded Readiness Safety Unit Tests", () => {
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
  });

  describe("Bounded Database Check Safety", () => {
    it("returns healthy and releases client when database query returns exact ready === 1", async () => {
      const releaseMock = vi.fn();
      const queryMock = vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] });
      const clientMock = { query: queryMock, release: releaseMock };
      const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) };

      const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 1000);
      expect(isHealthy).toBe(true);
      expect(poolMock.connect).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });

    it("cancels and releases client on database query timeout without leaking connections", async () => {
      const releaseMock = vi.fn();
      const slowQueryMock = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [{ ready: 1 }] }), 100))
      );
      const clientMock = { query: slowQueryMock, release: releaseMock };
      const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) };

      const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 20); // 20ms timeout
      expect(isHealthy).toBe(false);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });

    it("handles connection pool timeout and cleans up without leaking unreleased clients", async () => {
      const slowConnectPool = {
        connect: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({} as any), 100))
        ),
      };

      const isHealthy = await executeBoundedDatabaseCheck(slowConnectPool as any, 20);
      expect(isHealthy).toBe(false);
    });

    it("returns unhealthy on malformed database rows (empty array or wrong value)", async () => {
      const releaseMock = vi.fn();
      const poolMock1 = {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [] }),
          release: releaseMock,
        }),
      };
      expect(await executeBoundedDatabaseCheck(poolMock1 as any)).toBe(false);
      expect(releaseMock).toHaveBeenCalledTimes(1);

      const poolMock2 = {
        connect: vi.fn().mockResolvedValue({
          query: vi.fn().mockResolvedValue({ rows: [{ ready: 2 }] }),
          release: releaseMock,
        }),
      };
      expect(await executeBoundedDatabaseCheck(poolMock2 as any)).toBe(false);
    });
  });

  describe("Bounded Redis Check Safety", () => {
    it("returns healthy when Redis returns exact 'PONG'", async () => {
      const pingMock = vi.fn().mockResolvedValue("PONG");
      const isHealthy = await executeBoundedRedisCheck({ ping: pingMock } as any, 1000);
      expect(isHealthy).toBe(true);
      expect(pingMock).toHaveBeenCalledTimes(1);
    });

    it("aborts underlying network operation on Redis timeout via AbortSignal", async () => {
      let receivedSignal: AbortSignal | undefined;
      const slowPing = vi.fn().mockImplementation((options?: { signal?: AbortSignal }) => {
        receivedSignal = options?.signal;
        return new Promise((resolve) => setTimeout(() => resolve("PONG"), 100));
      });

      const isHealthy = await executeBoundedRedisCheck({ ping: slowPing } as any, 20);
      expect(isHealthy).toBe(false);
      expect(receivedSignal?.aborted).toBe(true);
    });

    it("returns unhealthy on malformed Redis return values", async () => {
      expect(await executeBoundedRedisCheck({ ping: vi.fn().mockResolvedValue("OK") } as any)).toBe(false);
      expect(await executeBoundedRedisCheck({ ping: vi.fn().mockResolvedValue(null) } as any)).toBe(false);
      expect(await executeBoundedRedisCheck({ ping: vi.fn().mockResolvedValue({ status: "PONG" }) } as any)).toBe(false);
    });
  });

  describe("Production Health Authorization & Zero-Connection Guarantee", () => {
    const validSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    it("permits unauthenticated checks in non-production environments", () => {
      expect(verifyHealthAuth(null, false, undefined)).toBe(true);
      expect(verifyHealthAuth("Bearer invalid", false, undefined)).toBe(true);
    });

    it("rejects unauthorized requests in production and opens ZERO dependency connections", async () => {
      const origEnv = process.env.NODE_ENV;
      const origSecret = process.env.HEALTHCHECK_SECRET;

      try {
        (process.env as any).NODE_ENV = "production";
        process.env.HEALTHCHECK_SECRET = validSecret;

        // Request without Authorization header
        const unauthorizedReq = new Request("http://localhost:3000/api/health/ready");
        const res = await getHealthReady(unauthorizedReq);

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error.code).toBe("UNAUTHORIZED");
        expect(body.error.message).toBe("Healthcheck authentication required.");
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        process.env.HEALTHCHECK_SECRET = origSecret;
      }
    });

    it("authorizes valid secret in production with constant-time match", () => {
      expect(verifyHealthAuth(`Bearer ${validSecret}`, true, validSecret)).toBe(true);
    });
  });
});
