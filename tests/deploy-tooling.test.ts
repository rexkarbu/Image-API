import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import { validateTargetUrl, isLoopbackHostname, safeFetch, runDeployVerify } from "@/scripts/deploy-verify";
import { validateHealthcheckSecret } from "@/scripts/deploy-preflight";

describe("Deployment Tooling, URL Safety & Single-Request safeFetch Tests", () => {
  describe("isLoopbackHostname", () => {
    it("identifies valid loopback hosts", () => {
      expect(isLoopbackHostname("localhost")).toBe(true);
      expect(isLoopbackHostname("127.0.0.1")).toBe(true);
      expect(isLoopbackHostname("::1")).toBe(true);
      expect(isLoopbackHostname("[::1]")).toBe(true);
    });

    it("identifies non-loopback hosts", () => {
      expect(isLoopbackHostname("example.com")).toBe(false);
      expect(isLoopbackHostname("api.example.com")).toBe(false);
      expect(isLoopbackHostname("192.168.1.1")).toBe(false);
      expect(isLoopbackHostname("10.0.0.1")).toBe(false);
    });
  });

  describe("validateTargetUrl", () => {
    it("accepts valid loopback HTTP and HTTPS root URLs", () => {
      const u1 = validateTargetUrl("http://localhost:3000");
      expect(u1.origin).toBe("http://localhost:3000");

      const u2 = validateTargetUrl("http://127.0.0.1:3000");
      expect(u2.origin).toBe("http://127.0.0.1:3000");

      const u3 = validateTargetUrl("http://[::1]:3000");
      expect(u3.origin).toBe("http://[::1]:3000");

      const u4 = validateTargetUrl("https://localhost:3000");
      expect(u4.origin).toBe("https://localhost:3000");
    });

    it("accepts valid remote HTTPS root URLs", () => {
      const u1 = validateTargetUrl("https://deployment-preview.vercel.app");
      expect(u1.origin).toBe("https://deployment-preview.vercel.app");

      const u2 = validateTargetUrl("https://custom-domain.com/");
      expect(u2.origin).toBe("https://custom-domain.com");
    });

    it("rejects insecure remote HTTP URLs without leaking URL", () => {
      expect(() => validateTargetUrl("http://custom-domain.com")).toThrow(/must use HTTPS/);
      expect(() => validateTargetUrl("http://api.production.org")).toThrow(/must use HTTPS/);
    });

    it("rejects URLs with embedded credentials", () => {
      expect(() => validateTargetUrl("https://admin:secret123@custom-domain.com")).toThrow(
        /embedded credentials/
      );
      expect(() => validateTargetUrl("http://user:pass@localhost:3000")).toThrow(
        /embedded credentials/
      );
    });

    it("rejects URLs with query strings or hash fragments", () => {
      expect(() => validateTargetUrl("https://custom-domain.com?token=xyz")).toThrow(
        /query parameters/
      );
      expect(() => validateTargetUrl("https://custom-domain.com#header")).toThrow(
        /hash fragments/
      );
    });

    it("rejects URLs with non-root path segments without echoing sensitive path in error", () => {
      expect(() => validateTargetUrl("https://custom-domain.com/secret_api_key_path")).toThrow(
        "Target URL must be an origin root without path segments."
      );
      expect(() => validateTargetUrl("http://localhost:3000/docs")).toThrow(
        "Target URL must be an origin root without path segments."
      );
    });

    it("rejects unsupported protocols", () => {
      expect(() => validateTargetUrl("ftp://localhost:21")).toThrow(/Unsupported protocol/);
      expect(() => validateTargetUrl("ws://localhost:3000")).toThrow(/Unsupported protocol/);
    });
  });

  describe("validateHealthcheckSecret Preflight Safety", () => {
    const validSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    it("passes valid 64-hex high-entropy secret in production/preview", () => {
      expect(() => validateHealthcheckSecret(validSecret, true)).not.toThrow();
    });

    it("allows missing/placeholder secret in local development mode", () => {
      expect(() => validateHealthcheckSecret(undefined, false)).not.toThrow();
      expect(() => validateHealthcheckSecret("placeholder_value", false)).not.toThrow();
    });

    it("rejects missing secret in preview/production", () => {
      expect(() => validateHealthcheckSecret(undefined, true)).toThrow(/is required/);
      expect(() => validateHealthcheckSecret("", true)).toThrow(/is required/);
    });

    it("rejects whitespace and unconfigured placeholders in preview/production", () => {
      expect(() => validateHealthcheckSecret(` ${validSecret} `, true)).toThrow(/whitespace/);
      expect(() =>
        validateHealthcheckSecret(
          "0000000000000000000000000000000000000000000000000000000000000000_replace_with_openssl_rand_hex_32",
          true
        )
      ).toThrow(/example placeholder/);
    });

    it("rejects low-entropy degenerate secrets", () => {
      expect(() => validateHealthcheckSecret("0".repeat(64), true)).toThrow();
      expect(() => validateHealthcheckSecret("a".repeat(64), true)).toThrow(/entropy is too low/);
      expect(() => validateHealthcheckSecret("12".repeat(32), true)).toThrow(/entropy is too low/);
    });
  });

  describe("safeFetch & runDeployVerify Controlled HTTP Mock Proofs", () => {
    let server: http.Server;
    let port: number;
    const requestLog: Array<{ path: string; headers: http.IncomingHttpHeaders }> = [];

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const url = req.url || "";
        requestLog.push({ path: url, headers: req.headers });

        if (url === "/timeout") {
          // Do not respond, let client timeout
          return;
        }

        if (url === "/redirect") {
          res.writeHead(302, { Location: "/target" });
          res.end();
          return;
        }

        if (url === "/oversized") {
          res.writeHead(200, { "Content-Type": "application/json" });
          // Send 70KB (> 64KB limit)
          res.end(Buffer.alloc(70 * 1024, "a"));
          return;
        }

        if (url === "/malformed-json") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{ bad json");
          return;
        }

        if (url === "/api/health/live") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", service: "image-api" }));
          return;
        }

        if (url === "/api/health/ready") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ready",
              service: "image-api",
              checks: { database: "healthy", redis: "healthy" },
            })
          );
          return;
        }

        if (url === "/openapi.json") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              openapi: "3.1.1",
              paths: { "/v1/images/transform": {} },
            })
          );
          return;
        }

        if (url === "/docs") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<!DOCTYPE html><html><head><title>Docs</title></head><body>Docs</body></html>");
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address() as { port: number };
          port = addr.port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
      requestLog.length = 0;
    });

    it("proves safeFetch performs exactly one request and parses JSON from the same response bytes", async () => {
      const result = await safeFetch(`http://127.0.0.1:${port}/api/health/live`);
      expect(requestLog.length).toBe(1);
      expect(result.status).toBe(200);
      expect(result.text).toContain("image-api");
      const json = result.json();
      expect(json.status).toBe("ok");
      expect(json.service).toBe("image-api");
      // Calling json() repeatedly uses cached text without performing additional requests
      expect(result.json().status).toBe("ok");
      expect(requestLog.length).toBe(1);
    });

    it("aborts and throws on request timeout", async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/timeout`, {}, 50)).rejects.toThrow();
    });

    it("rejects HTTP redirects immediately without following hops", async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/redirect`)).rejects.toThrow(
        /Redirect rejected/
      );
    });

    it("rejects oversized response bodies exceeding 64KB", async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/oversized`)).rejects.toThrow(
        /exceeded 64KB/
      );
    });

    it("rejects malformed JSON payloads gracefully", async () => {
      const result = await safeFetch(`http://127.0.0.1:${port}/malformed-json`);
      expect(result.status).toBe(200);
      expect(() => result.json()).toThrow(/Invalid JSON/);
    });

    it("proves runDeployVerify sends HEALTHCHECK_SECRET ONLY to /api/health/ready and exactly 1 request per route", async () => {
      const secret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
      const origSecret = process.env.HEALTHCHECK_SECRET;

      try {
        process.env.HEALTHCHECK_SECRET = secret;
        await runDeployVerify(`http://127.0.0.1:${port}`);

        // Exactly 4 requests total across 4 distinct routes
        expect(requestLog.length).toBe(4);

        const liveReq = requestLog.find((r) => r.path === "/api/health/live");
        const readyReq = requestLog.find((r) => r.path === "/api/health/ready");
        const openApiReq = requestLog.find((r) => r.path === "/openapi.json");
        const docsReq = requestLog.find((r) => r.path === "/docs");

        expect(liveReq).toBeDefined();
        expect(readyReq).toBeDefined();
        expect(openApiReq).toBeDefined();
        expect(docsReq).toBeDefined();

        // 1. /api/health/ready receives Authorization: Bearer <secret>
        expect(readyReq!.headers.authorization).toBe(`Bearer ${secret}`);

        // 2. /api/health/live receives NO Authorization header
        expect(liveReq!.headers.authorization).toBeUndefined();

        // 3. /openapi.json receives NO Authorization header
        expect(openApiReq!.headers.authorization).toBeUndefined();

        // 4. /docs receives NO Authorization header
        expect(docsReq!.headers.authorization).toBeUndefined();
      } finally {
        process.env.HEALTHCHECK_SECRET = origSecret;
      }
    });
  });
});
