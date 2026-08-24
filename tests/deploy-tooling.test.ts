import { describe, it, expect } from "vitest";
import { validateTargetUrl, isLoopbackHostname } from "@/scripts/deploy-verify";

describe("Deployment Tooling & URL Validation Negative Tests", () => {
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
});
