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

    it("rejects insecure remote HTTP URLs", () => {
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

    it("rejects URLs with non-root path segments", () => {
      expect(() => validateTargetUrl("https://custom-domain.com/api")).toThrow(
        /origin root without path segments/
      );
      expect(() => validateTargetUrl("http://localhost:3000/docs")).toThrow(
        /origin root without path segments/
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

  describe("safeFetch Bounded Single-Request Semantics (Local HTTP Server)", () => {
    let server: http.Server;
    let port: number;
    let requestCount = 0;
    let lastHeaders: http.IncomingHttpHeaders | null = null;
    let lastPath = "";

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        requestCount++;
        lastHeaders = req.headers;
        lastPath = req.url || "";

        if (req.url === "/timeout") {
          // Do not respond, let client timeout
          return;
        }

        if (req.url === "/redirect") {
          res.writeHead(302, { Location: "/target" });
          res.end();
          return;
        }

        if (req.url === "/oversized") {
          res.writeHead(200, { "Content-Type": "application/json" });
          // Send 70KB (> 64KB limit)
          res.end(Buffer.alloc(70 * 1024, "a"));
          return;
        }

        if (req.url === "/malformed-json") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{ bad json");
          return;
        }

        if (req.url === "/api/health/live") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", service: "image-api" }));
          return;
        }

        if (req.url === "/api/health/ready") {
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
      requestCount = 0;
      lastHeaders = null;
      lastPath = "";
    });

    it("proves safeFetch performs exactly one request and parses JSON from the same response bytes", async () => {
      const result = await safeFetch(`http://127.0.0.1:${port}/api/health/live`);
      expect(requestCount).toBe(1);
      expect(result.status).toBe(200);
      expect(result.text).toContain("image-api");
      const json = result.json();
      expect(json.status).toBe("ok");
      expect(json.service).toBe("image-api");
      // Calling json() repeatedly uses cached text without performing additional requests
      expect(result.json().status).toBe("ok");
      expect(requestCount).toBe(1);
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
  });
});
