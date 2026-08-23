import { describe, it, expect } from "vitest";
import {
  generateApiKeySecret,
  generateFullApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  deriveApiKeyDisplayPrefix,
  deriveApiKeyStatus,
  canManageApiKeys,
  API_KEY_PREFIX,
} from "@/lib/crypto/api-keys";

describe("API Key Cryptographic Primitives & Helpers", () => {
  it("generates 32-byte entropy in unpadded Base64URL (43 chars)", () => {
    const secret = generateApiKeySecret();
    expect(secret).toHaveLength(43);
    // Base64URL character set: A-Z, a-z, 0-9, -, _ (no padding '=')
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates full keys with exact 'img_live_' prefix and 52-char total length", () => {
    const { plaintextKey, keyPrefix, keyHash } = generateFullApiKey();
    expect(plaintextKey.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(plaintextKey).toHaveLength(52); // 9 + 43 = 52
    expect(isValidApiKeyFormat(plaintextKey)).toBe(true);

    // keyPrefix is img_live_ + first 8 chars of secret
    expect(keyPrefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(keyPrefix).toHaveLength(17); // 9 + 8 = 17

    // keyHash is 64 lowercase hex characters
    expect(keyHash).toHaveLength(64);
    expect(keyHash).toMatch(/^[a-f0-9]{64}$/);

    // Plaintext differs strictly from hash and prefix
    expect(plaintextKey).not.toEqual(keyHash);
    expect(plaintextKey).not.toEqual(keyPrefix);
  });

  it("ensures uniqueness across a sample of 100 generated keys", () => {
    const keys = new Set<string>();
    const hashes = new Set<string>();
    const prefixes = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const { plaintextKey, keyPrefix, keyHash } = generateFullApiKey();
      keys.add(plaintextKey);
      hashes.add(keyHash);
      prefixes.add(keyPrefix);
    }

    expect(keys.size).toBe(100);
    expect(hashes.size).toBe(100);
    expect(prefixes.size).toBe(100);
  });

  it("computes deterministic SHA-256 hashes", () => {
    const testKey = "img_live_ABCDEF1234567890abcdef1234567890ABCDEF12345";
    const hash1 = hashApiKey(testKey);
    const hash2 = hashApiKey(testKey);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects malformed keys when hashing", () => {
    expect(() => hashApiKey("invalid_prefix_key")).toThrow("Invalid API key format for hashing.");
    expect(() => hashApiKey("")).toThrow("Invalid API key format for hashing.");
  });

  it("derives human-friendly masked display prefixes", () => {
    const prefix = "img_live_ab12cd34";
    const display = deriveApiKeyDisplayPrefix(prefix);
    expect(display).toBe("img_live_ab12cd34••••••••");
  });

  describe("deriveApiKeyStatus", () => {
    const now = new Date("2026-08-23T12:00:00Z");

    it("returns 'revoked' if stored status is revoked, regardless of expiry", () => {
      const futureDate = new Date("2026-08-24T12:00:00Z");
      expect(deriveApiKeyStatus("revoked", futureDate, now)).toBe("revoked");
      expect(deriveApiKeyStatus("revoked", null, now)).toBe("revoked");
    });

    it("returns 'expired' if stored status is active but expiresAt is in the past", () => {
      const pastDate = new Date("2026-08-22T12:00:00Z");
      expect(deriveApiKeyStatus("active", pastDate, now)).toBe("expired");
    });

    it("returns 'active' if stored status is active and expiresAt is in the future or null", () => {
      const futureDate = new Date("2026-08-24T12:00:00Z");
      expect(deriveApiKeyStatus("active", futureDate, now)).toBe("active");
      expect(deriveApiKeyStatus("active", null, now)).toBe("active");
    });
  });

  describe("canManageApiKeys Authorization Helper", () => {
    it("allows 'owner' and 'admin' roles to manage API keys", () => {
      expect(canManageApiKeys("owner")).toBe(true);
      expect(canManageApiKeys("admin")).toBe(true);
    });

    it("denies 'member' and unknown roles from managing API keys", () => {
      expect(canManageApiKeys("member")).toBe(false);
      expect(canManageApiKeys("guest")).toBe(false);
      expect(canManageApiKeys(null)).toBe(false);
      expect(canManageApiKeys(undefined)).toBe(false);
    });
  });
});
