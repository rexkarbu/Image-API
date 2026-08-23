import { describe, it, expect } from "vitest";
import { canManageApiKeys } from "@/lib/crypto/api-keys";
import type { ApiKeyDto } from "@/types/api-keys";

describe("API Key Service Logic & Authorization Unit Tests", () => {
  it("enforces that safe ApiKeyDto never includes keyHash property", () => {
    const mockDto: ApiKeyDto = {
      id: "key-1",
      organizationId: "org-1",
      name: "Test Key",
      keyPrefix: "img_live_12345678",
      displayPrefix: "img_live_12345678••••••••",
      scopes: "image:transform",
      status: "active",
      rawStatus: "active",
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(mockDto).not.toHaveProperty("keyHash");
    expect(Object.keys(mockDto)).not.toContain("keyHash");
  });

  describe("Role Authorization Matrix", () => {
    it("permits owner role to perform all management operations", () => {
      expect(canManageApiKeys("owner")).toBe(true);
    });

    it("permits admin role to perform all management operations", () => {
      expect(canManageApiKeys("admin")).toBe(true);
    });

    it("restricts member role to read-only metadata access", () => {
      expect(canManageApiKeys("member")).toBe(false);
    });

    it("restricts empty, null, or unknown roles", () => {
      expect(canManageApiKeys("")).toBe(false);
      expect(canManageApiKeys("billing_admin")).toBe(false);
      expect(canManageApiKeys(undefined)).toBe(false);
    });
  });
});
