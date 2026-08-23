import { describe, it, expect } from "vitest";
import {
  deriveIpIdentifier,
  deriveApiKeyIdentifier,
  validateRateLimitSecret,
} from "@/lib/security/rate-limit-identifiers";

describe("Privacy-Preserving Rate Limit Identifiers & Secret Contract", () => {
  const validSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // exactly 64 lowercase hex chars

  describe("HMAC Secret Validation (validateRateLimitSecret)", () => {
    it("accepts valid 64 lowercase hexadecimal character secret", () => {
      const secret = validateRateLimitSecret(validSecret);
      expect(secret).toBe(validSecret);
    });

    it("rejects 32-character secrets", () => {
      const secret32 = "0123456789abcdef0123456789abcdef";
      expect(() => validateRateLimitSecret(secret32)).toThrow(/must be exactly 64 lowercase hexadecimal/);
    });

    it("rejects 63-character and 65-character secrets", () => {
      const secret63 = validSecret.slice(0, 63);
      const secret65 = validSecret + "a";
      expect(() => validateRateLimitSecret(secret63)).toThrow(/must be exactly 64 lowercase hexadecimal/);
      expect(() => validateRateLimitSecret(secret65)).toThrow(/must be exactly 64 lowercase hexadecimal/);
    });

    it("rejects uppercase hexadecimal characters", () => {
      const upperSecret = "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef";
      expect(() => validateRateLimitSecret(upperSecret)).toThrow(/must be exactly 64 lowercase hexadecimal/);
    });

    it("rejects non-hexadecimal characters", () => {
      const nonHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdeg"; // 'g' is non-hex
      expect(() => validateRateLimitSecret(nonHex)).toThrow(/must be exactly 64 lowercase hexadecimal/);
    });

    it("rejects whitespace and empty values", () => {
      expect(() => validateRateLimitSecret("")).toThrow(/must be exactly 64 lowercase hexadecimal/);
      expect(() => validateRateLimitSecret("   ")).toThrow(/must be exactly 64 lowercase hexadecimal/);
    });

    it("rejects known placeholder strings", () => {
      const placeholder = "0000000000000000000000000000000000000000000000000000000000000000_replace_with_openssl_rand_hex_32";
      expect(() => validateRateLimitSecret(placeholder)).toThrow();
    });
  });

  describe("Identifier Derivation & Normalization", () => {
    it("produces deterministic 64-character lowercase hexadecimal HMAC output", () => {
      const id1 = deriveIpIdentifier("203.0.113.195", validSecret);
      const id2 = deriveIpIdentifier("203.0.113.195", validSecret);

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{64}$/);
      expect(id1).not.toContain("203.0.113.195");
    });

    it("enforces strict domain separation between IP and Key spaces", () => {
      const sharedIp = "192.0.2.1";
      const ipHash = deriveIpIdentifier(sharedIp, validSecret);
      const keyHash = deriveApiKeyIdentifier("192.0.2.1", "dummy-key", validSecret);

      expect(ipHash).not.toBe(keyHash);
      expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
      expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("normalizes equivalent IPv6 representations to identical HMAC identifiers", () => {
      const full = "2001:0db8:0000:0000:0000:0000:0000:0001";
      const compressed = "2001:db8::1";
      const uppercase = "2001:DB8::1";

      const idFull = deriveIpIdentifier(full, validSecret);
      const idCompressed = deriveIpIdentifier(compressed, validSecret);
      const idUpper = deriveIpIdentifier(uppercase, validSecret);

      expect(idFull).toBe(idCompressed);
      expect(idFull).toBe(idUpper);
    });

    it("distinguishes different tenants using the same API key ID", () => {
      const keyId = "550e8400-e29b-41d4-a716-446655440000";
      const orgA = deriveApiKeyIdentifier("org-tenant-a", keyId, validSecret);
      const orgB = deriveApiKeyIdentifier("org-tenant-b", keyId, validSecret);

      expect(orgA).not.toBe(orgB);
    });

    it("rejects empty client IP or empty IDs", () => {
      expect(() => deriveIpIdentifier("", validSecret)).toThrow(/clientIp is empty/);
      expect(() => deriveApiKeyIdentifier("", "key-1", validSecret)).toThrow(/organizationId is empty/);
      expect(() => deriveApiKeyIdentifier("org-1", "", validSecret)).toThrow(/apiKeyId is empty/);
    });

    it("rejects invalid IP addresses during identifier derivation", () => {
      expect(() => deriveIpIdentifier("not-an-ip", validSecret)).toThrow(/not a valid IP address/);
      expect(() => deriveIpIdentifier("192.168.1.500", validSecret)).toThrow(/not a valid IP address/);
    });
  });
});
