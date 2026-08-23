import { describe, it, expect } from "vitest";
import {
  deriveIpIdentifier,
  deriveApiKeyIdentifier,
} from "@/lib/security/rate-limit-identifiers";

describe("Privacy-Preserving Rate Limit Identifiers", () => {
  const validSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 64 hex chars (32 bytes)

  it("produces deterministic 64-character lowercase hexadecimal HMAC output", () => {
    const id1 = deriveIpIdentifier("203.0.113.195", validSecret);
    const id2 = deriveIpIdentifier("203.0.113.195", validSecret);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{64}$/);
    expect(id1).not.toContain("203.0.113.195");
  });

  it("enforces strict domain separation between IP and Key spaces", () => {
    // If an IP string matches the concatenated key string, domain prefixes "ip\0" vs "key\0" guarantee different hashes
    const sharedString = "tenant-123\0key-456";
    const ipHash = deriveIpIdentifier(sharedString, validSecret);
    const keyHash = deriveApiKeyIdentifier("tenant-123", "key-456", validSecret);

    expect(ipHash).not.toBe(keyHash);
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes IP addresses to ensure consistent bucket lookup regardless of casing", () => {
    const idLower = deriveIpIdentifier("2001:db8::1", validSecret);
    const idUpper = deriveIpIdentifier("2001:DB8::1", validSecret);

    expect(idLower).toBe(idUpper);
  });

  it("distinguishes different tenants using the same API key ID", () => {
    const keyId = "550e8400-e29b-41d4-a716-446655440000";
    const orgA = deriveApiKeyIdentifier("org-tenant-a", keyId, validSecret);
    const orgB = deriveApiKeyIdentifier("org-tenant-b", keyId, validSecret);

    expect(orgA).not.toBe(orgB);
  });

  it("rejects when secret is shorter than 32 characters", () => {
    expect(() => deriveIpIdentifier("127.0.0.1", "short-secret")).toThrow(/insufficiently long/);
  });

  it("rejects empty client IP or empty IDs", () => {
    expect(() => deriveIpIdentifier("", validSecret)).toThrow(/clientIp is empty/);
    expect(() => deriveApiKeyIdentifier("", "key-1", validSecret)).toThrow(/organizationId is empty/);
    expect(() => deriveApiKeyIdentifier("org-1", "", validSecret)).toThrow(/apiKeyId is empty/);
  });
});
