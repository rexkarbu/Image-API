import { describe, it, expect } from "vitest";
import {
  apiKeyNameSchema,
  apiKeyIdSchema,
  apiKeyStatusFilterSchema,
  apiKeyRotationModeSchema,
  createApiKeyInputSchema,
  rotateApiKeyInputSchema,
} from "@/lib/validations/api-keys";

describe("API Key Zod Validations", () => {
  describe("apiKeyNameSchema", () => {
    it("accepts valid names between 2 and 64 characters", () => {
      expect(apiKeyNameSchema.parse("Production Server")).toBe("Production Server");
      expect(apiKeyNameSchema.parse("  Trimmed Key  ")).toBe("Trimmed Key");
      expect(apiKeyNameSchema.parse("AB")).toBe("AB");
      expect(apiKeyNameSchema.parse("A".repeat(64))).toBe("A".repeat(64));
    });

    it("rejects names shorter than 2 characters", () => {
      expect(() => apiKeyNameSchema.parse("A")).toThrow("at least 2 characters");
      expect(() => apiKeyNameSchema.parse("   ")).toThrow("at least 2 characters");
      expect(() => apiKeyNameSchema.parse("")).toThrow("at least 2 characters");
    });

    it("rejects names longer than 64 characters", () => {
      expect(() => apiKeyNameSchema.parse("A".repeat(65))).toThrow("at most 64 characters");
    });

    it("rejects control characters and newlines", () => {
      expect(() => apiKeyNameSchema.parse("Key\nName")).toThrow("cannot contain control characters");
      expect(() => apiKeyNameSchema.parse("Key\rName")).toThrow("cannot contain control characters");
      expect(() => apiKeyNameSchema.parse("Key\tName")).toThrow("cannot contain control characters");
      expect(() => apiKeyNameSchema.parse("Key\x00Name")).toThrow("cannot contain control characters");
    });
  });

  describe("apiKeyIdSchema", () => {
    it("accepts valid non-empty IDs", () => {
      expect(apiKeyIdSchema.parse("key-12345")).toBe("key-12345");
    });

    it("rejects empty IDs", () => {
      expect(() => apiKeyIdSchema.parse("")).toThrow("API key ID is required");
      expect(() => apiKeyIdSchema.parse("   ")).toThrow("API key ID is required");
    });
  });

  describe("apiKeyStatusFilterSchema", () => {
    it("accepts valid filter values and defaults to 'all'", () => {
      expect(apiKeyStatusFilterSchema.parse("all")).toBe("all");
      expect(apiKeyStatusFilterSchema.parse("active")).toBe("active");
      expect(apiKeyStatusFilterSchema.parse("expired")).toBe("expired");
      expect(apiKeyStatusFilterSchema.parse("revoked")).toBe("revoked");
      expect(apiKeyStatusFilterSchema.parse(undefined)).toBe("all");
    });

    it("rejects invalid filter values", () => {
      expect(() => apiKeyStatusFilterSchema.parse("deleted")).toThrow();
      expect(() => apiKeyStatusFilterSchema.parse("disabled")).toThrow();
    });
  });

  describe("apiKeyRotationModeSchema", () => {
    it("accepts 'immediate' and 'grace_24h'", () => {
      expect(apiKeyRotationModeSchema.parse("immediate")).toBe("immediate");
      expect(apiKeyRotationModeSchema.parse("grace_24h")).toBe("grace_24h");
    });

    it("rejects invalid rotation modes", () => {
      expect(() => apiKeyRotationModeSchema.parse("delay_7d")).toThrow();
      expect(() => apiKeyRotationModeSchema.parse("instant")).toThrow();
    });
  });

  describe("createApiKeyInputSchema", () => {
    it("validates valid creation payload", () => {
      const parsed = createApiKeyInputSchema.parse({
        name: "Backend Service",
        scopes: "image:transform",
      });
      expect(parsed.name).toBe("Backend Service");
      expect(parsed.scopes).toBe("image:transform");
    });

    it("rejects arbitrary unsupported scopes", () => {
      expect(() =>
        createApiKeyInputSchema.parse({
          name: "Backend Service",
          scopes: "admin:all",
        })
      ).toThrow();
    });
  });

  describe("rotateApiKeyInputSchema", () => {
    it("validates rotation payload", () => {
      const parsed = rotateApiKeyInputSchema.parse({
        keyId: "key-xyz",
        mode: "grace_24h",
      });
      expect(parsed.keyId).toBe("key-xyz");
      expect(parsed.mode).toBe("grace_24h");
    });
  });
});
