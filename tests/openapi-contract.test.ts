import { describe, it, expect } from "vitest";
import { openApiSpec } from "@/lib/openapi/spec";
import { validateOpenApiSpec } from "@/scripts/openapi-check";

describe("OpenAPI 3.1 Contract & Runtime Invariant Adversarial Tests", () => {
  it("proves canonical openApiSpec passes SwaggerParser schema and invariant validation", async () => {
    await expect(validateOpenApiSpec()).resolves.not.toThrow();
  });

  describe("POST /v1/images/transform Contract Alignment", () => {
    const transformPost = openApiSpec.paths["/v1/images/transform"].post;

    it("requires Idempotency-Key with 16-128 printable ASCII characters pattern", () => {
      const idempParam = transformPost.parameters?.find((p) => p.name.toLowerCase() === "idempotency-key");
      expect(idempParam).toBeDefined();
      expect(idempParam!.required).toBe(true);
      expect(idempParam!.schema.minLength).toBe(16);
      expect(idempParam!.schema.maxLength).toBe(128);
      expect(idempParam!.schema.pattern).toBe("^[!-~]{16,128}$");
    });

    it("specifies correct input and output formats matching Sharp runtime", () => {
      const formProperties = transformPost.requestBody.content["multipart/form-data"].schema.properties;

      // File input description rejects AVIF input claim
      expect(formProperties.file.description).toContain("JPEG, PNG, WebP");
      expect(formProperties.file.description).not.toContain("AVIF input is supported");

      // Target output format enum
      expect(formProperties.format.enum).toEqual(["webp", "jpeg", "png", "avif"]);
      expect(formProperties.format.default).toBe("webp");
    });

    it("specifies exact runtime defaults for quality, fit, and withoutEnlargement", () => {
      const formProperties = transformPost.requestBody.content["multipart/form-data"].schema.properties;

      expect(formProperties.quality.default).toBe(80);
      expect(formProperties.quality.minimum).toBe(1);
      expect(formProperties.quality.maximum).toBe(100);

      expect(formProperties.fit.enum).toEqual(["cover", "contain", "inside", "fill"]);
      expect(formProperties.fit.enum).not.toContain("outside");
      expect(formProperties.fit.default).toBe("inside");

      expect(formProperties.withoutEnlargement.default).toBe(true);
    });

    it("specifies error envelope schema with code, message, and requestId matching runtime", () => {
      const errorSchema = openApiSpec.components.schemas.ErrorEnvelope;
      expect(errorSchema.required).toEqual(["error"]);
      expect(errorSchema.properties.error.required).toEqual(["code", "message", "requestId"]);
    });

    it("specifies uniform 401 message matching runtime ApiError", () => {
      const unauthorized401 = transformPost.responses["401"];
      expect(unauthorized401.description).toContain("Invalid API credentials.");
    });

    it("specifies all actual success headers including rate limit and metadata headers", () => {
      const headers = transformPost.responses["200"].headers;
      const expectedHeaders = [
        "Content-Type",
        "Content-Length",
        "Content-Disposition",
        "Cache-Control",
        "X-Content-Type-Options",
        "X-Request-ID",
        "X-Usage-Units",
        "X-Image-Width",
        "X-Image-Height",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ];

      for (const h of expectedHeaders) {
        expect(headers[h as keyof typeof headers]).toBeDefined();
      }
    });

    it("strictly excludes internal operational routes from public specification", () => {
      const paths = Object.keys(openApiSpec.paths);
      expect(paths).toContain("/v1/images/transform");
      expect(paths).toContain("/api/health/live");
      expect(paths).toContain("/api/health/ready");

      expect(paths).not.toContain("/api/webhooks/stripe");
      expect(paths).not.toContain("/api/cron/billing");
      expect(paths).not.toContain("/api/auth");
      expect(paths).not.toContain("/api/auth/[...all]");
    });
  });
});
