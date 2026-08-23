import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveIpIdentifier,
  deriveApiKeyIdentifier,
  validateRateLimitSecret,
} from "@/lib/security/rate-limit-identifiers";

describe("Privacy-Preserving Rate Limit Identifiers & Secret Contract", () => {
  const validSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // exactly 64 lowercase hex chars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("HMAC Secret Validation (validateRateLimitSecret)", () => {
    it("accepts valid 64 lowercase hexadecimal character secret", () => {
      const secret = validateRateLimitSecret(validSecret);
      expect(secret).toBe(validSecret);
    });

    it("rejects valid 64-character hex surrounded by leading/trailing whitespace without trimming", () => {
      expect(() => validateRateLimitSecret(` ${validSecret}`)).toThrow(
        /must be exactly 64 lowercase hexadecimal/
      );
      expect(() => validateRateLimitSecret(`${validSecret} `)).toThrow(
        /must be exactly 64 lowercase hexadecimal/
      );
      expect(() => validateRateLimitSecret(`  ${validSecret}  `)).toThrow(
        /must be exactly 64 lowercase hexadecimal/
      );
    });

    it("rejects empty explicit secret even if environment contains a valid secret (no fallback on empty string)", () => {
      process.env.RATE_LIMIT_IDENTIFIER_SECRET = validSecret;
      expect(() => validateRateLimitSecret("")).toThrow(
        /must be exactly 64 lowercase hexadecimal/
      );
    });

    it("rejects when environment variable is missing and explicitSecret is undefined", () => {
      delete process.env.RATE_LIMIT_IDENTIFIER_SECRET;
      expect(() => validateRateLimitSecret(undefined)).toThrow(
        /must be exactly 64 lowercase hexadecimal/
      );
    });

    it("uses valid environment variable when explicitSecret is undefined", () => {
      process.env.RATE_LIMIT_IDENTIFIER_SECRET = validSecret;
      expect(validateRateLimitSecret(undefined)).toBe(validSecret);
    });

    it("rejects all-zero placeholder value", () => {
      const allZeros = "0".repeat(64);
      expect(() => validateRateLimitSecret(allZeros)).toThrow(/all-zero placeholder/);
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

    it("rejects known placeholder strings", () => {
      const placeholder = "0000000000000000000000000000000000000000000000000000000000000000_replace_with_openssl_rand_hex_32";
      expect(() => validateRateLimitSecret(placeholder)).toThrow();
    });

    it("never prints the rejected secret in error messages", () => {
      const secretCandidate = "SUPER_SECRET_VALUE_THAT_MUST_NEVER_BE_LOGGED_OR_PRINTED_12345678";
      try {
        validateRateLimitSecret(secretCandidate);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as Error).message).not.toContain(secretCandidate);
      }
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
