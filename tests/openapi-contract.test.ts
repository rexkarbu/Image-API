import { describe, it, expect } from "vitest";
import { openApiSpec } from "@/lib/openapi/spec";
import { validateOpenApiSpec } from "@/scripts/openapi-check";
import { validateTargetUrl } from "@/scripts/deploy-verify";

describe("OpenAPI 3.1.1 Contract & Deployment URL Validation Unit Tests", () => {
  it("validates that canonical openApiSpec conforms to all structural rules", () => {
    expect(() => validateOpenApiSpec()).not.toThrow();
  });

  it("exposes only public endpoints and excludes operational internal routes", () => {
    const paths = Object.keys(openApiSpec.paths);

    expect(paths).toContain("/v1/images/transform");
    expect(paths).toContain("/api/health/live");
    expect(paths).toContain("/api/health/ready");

    expect(paths).not.toContain("/api/webhooks/stripe");
    expect(paths).not.toContain("/api/cron/billing");
    expect(paths).not.toContain("/api/auth");
  });

  describe("validateTargetUrl", () => {
    it("accepts valid loopback HTTP and HTTPS URLs", () => {
      const u1 = validateTargetUrl("http://localhost:3000");
      expect(u1.origin).toBe("http://localhost:3000");

      const u2 = validateTargetUrl("http://127.0.0.1:3000");
      expect(u2.origin).toBe("http://127.0.0.1:3000");

      const u3 = validateTargetUrl("https://localhost:3000");
      expect(u3.origin).toBe("https://localhost:3000");
    });

    it("accepts valid remote HTTPS URLs", () => {
      const u1 = validateTargetUrl("https://api.imageapi.dev");
      expect(u1.origin).toBe("https://api.imageapi.dev");

      const u2 = validateTargetUrl("https://preview-123.vercel.app");
      expect(u2.origin).toBe("https://preview-123.vercel.app");
    });

    it("rejects insecure remote HTTP URLs", () => {
      expect(() => validateTargetUrl("http://api.imageapi.dev")).toThrow(/must use HTTPS/);
      expect(() => validateTargetUrl("http://production-domain.com")).toThrow(/must use HTTPS/);
    });

    it("rejects URLs with embedded credentials or fragments", () => {
      expect(() => validateTargetUrl("https://user:pass@api.imageapi.dev")).toThrow(/credentials/);
      expect(() => validateTargetUrl("https://api.imageapi.dev/#anchor")).toThrow(/fragments/);
    });
  });
});
