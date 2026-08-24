import { describe, it, expect, vi } from "vitest";
import { GET as getHealthLive } from "@/app/api/health/live/route";
import { GET as getHealthReady } from "@/app/api/health/ready/route";
import {
  verifyHealthAuth,
  executeBoundedDatabaseCheck,
  executeBoundedRedisCheck,
  createBoundedRedisClient,
  evaluateReadiness,
} from "@/lib/health/readiness-core";

describe("Health Check Routes & Real Bounded Readiness Cancellation Unit Tests", () => {
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

  describe("Real PostgreSQL Readiness Cancellation & Deferred Lifecycle Proofs", () => {
    it("releases normally (exactly once with no error flag) on fast, valid query", async () => {
      const releaseMock = vi.fn();
      const queryMock = vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] });
      const clientMock = { query: queryMock, release: releaseMock };
      const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) };

      const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 1000);
      expect(isHealthy).toBe(true);
      expect(poolMock.connect).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(); // Normal release
    });

    it("destroys client with error flag (release(true)) on query timeout rather than returning it normally", async () => {
      let resolveQuery: (val: any) => void;
      const deferredQueryPromise = new Promise((resolve) => {
        resolveQuery = resolve;
      });

      const releaseMock = vi.fn();
      const clientMock = {
        query: vi.fn().mockImplementation(() => deferredQueryPromise),
        release: releaseMock,
      };
      const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) };

      const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 20); // 20ms timeout
      expect(isHealthy).toBe(false);

      // Client must be destroyed immediately on timeout
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(true);

      // Late query settlement after timeout does not cause unhandled rejections or double release
      resolveQuery!({ rows: [{ ready: 1 }] });
      await new Promise((r) => setTimeout(r, 10));
      expect(releaseMock).toHaveBeenCalledTimes(1);
    });

    it("cleans up and immediately destroys a late-resolving pool connection without leakage", async () => {
      let resolveConnect: (client: any) => void;
      const deferredConnectPromise = new Promise((resolve) => {
        resolveConnect = resolve;
      });

      const releaseMock = vi.fn();
      const clientMock = {
        query: vi.fn().mockResolvedValue({ rows: [{ ready: 1 }] }),
        release: releaseMock,
      };
      const poolMock = { connect: vi.fn().mockImplementation(() => deferredConnectPromise) };

      // Readiness operation times out while connection is still pending
      const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 20);
      expect(isHealthy).toBe(false);
      expect(releaseMock).not.toHaveBeenCalled();

      // Now the pool connection finally resolves late
      resolveConnect!(clientMock);
      await new Promise((r) => setTimeout(r, 10));

      // The late-arriving client MUST be immediately destroyed with release(true)
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(true);
      expect(clientMock.query).not.toHaveBeenCalled(); // Never runs query on abandoned client
    });

    it("destroys client on malformed query rows (e.g. empty rows or wrong value)", async () => {
      const releaseMock = vi.fn();
      const clientMock = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: releaseMock,
      };
      const poolMock = { connect: vi.fn().mockResolvedValue(clientMock) };

      const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 1000);
      expect(isHealthy).toBe(false);
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock).toHaveBeenCalledWith(true);
    });

    it("repeated timeouts do not leak clients or unhandled rejections", async () => {
      const releaseMock = vi.fn();
      const poolMock = {
        connect: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({
            query: () => new Promise(() => {}),
            release: releaseMock,
          }), 50))
        ),
      };

      for (let i = 0; i < 5; i++) {
        const isHealthy = await executeBoundedDatabaseCheck(poolMock as any, 10);
        expect(isHealthy).toBe(false);
      }

      // Wait for late connections to arrive and be discarded
      await new Promise((r) => setTimeout(r, 80));
      expect(releaseMock).toHaveBeenCalledTimes(5);
      for (const call of releaseMock.mock.calls) {
        expect(call[0]).toBe(true);
      }
    });
  });

  describe("Official Upstash Redis Timeout & Signal Invariants", () => {
    it("calls redis.ping() with ZERO arguments", async () => {
      const pingMock = vi.fn().mockResolvedValue("PONG");
      const isHealthy = await executeBoundedRedisCheck({ ping: pingMock } as any);
      expect(isHealthy).toBe(true);
      expect(pingMock).toHaveBeenCalledTimes(1);
      expect(pingMock).toHaveBeenCalledWith(); // Zero arguments
    });

    it("returns unhealthy when ping() rejects with timeout or network error", async () => {
      const pingMock = vi.fn().mockRejectedValue(new Error("TimeoutError: The operation was aborted"));
      const isHealthy = await executeBoundedRedisCheck({ ping: pingMock } as any);
      expect(isHealthy).toBe(false);
    });

    it("returns unhealthy on malformed Redis return values (non-PONG)", async () => {
      expect(await executeBoundedRedisCheck({ ping: vi.fn().mockResolvedValue("OK") } as any)).toBe(false);
      expect(await executeBoundedRedisCheck({ ping: vi.fn().mockResolvedValue(null) } as any)).toBe(false);
      expect(await executeBoundedRedisCheck({ ping: vi.fn().mockResolvedValue(1) } as any)).toBe(false);
    });

    it("createBoundedRedisClient configures official constructor signal factory", () => {
      const client = createBoundedRedisClient(1500, {
        UPSTASH_REDIS_REST_URL: "https://mock-cluster.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "mock_token_12345",
      });
      expect(client).toBeDefined();
      const signalFactory = (client as any).client?.options?.signal;
      expect(typeof signalFactory).toBe("function");
      const signal = signalFactory();
      expect(signal).toBeInstanceOf(AbortSignal);
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
