import { describe, it, expect } from "vitest";
import { validateIdempotencyKey, deriveRequestId } from "@/lib/api/idempotency";
import { ApiError } from "@/lib/api/errors";

describe("Idempotency Key & Request ID Helper Unit Tests", () => {
  const reqId = "req-test-uuid";

  it("accepts valid visible ASCII strings between 16 and 128 characters", () => {
    const validKey16 = "1234567890123456";
    const validKey64 = "a".repeat(64);
    const validKey128 = "b".repeat(128);
    const validKeySymbols = "abc-123_DEF!@#$%^&*()";

    expect(validateIdempotencyKey(validKey16, reqId)).toBe(validKey16);
    expect(validateIdempotencyKey(validKey64, reqId)).toBe(validKey64);
    expect(validateIdempotencyKey(validKey128, reqId)).toBe(validKey128);
    expect(validateIdempotencyKey(validKeySymbols, reqId)).toBe(validKeySymbols);
  });

  it("rejects missing, null, or undefined idempotency keys with 400 INVALID_IDEMPOTENCY_KEY", () => {
    expect(() => validateIdempotencyKey(null, reqId)).toThrow(ApiError);
    expect(() => validateIdempotencyKey(undefined, reqId)).toThrow(ApiError);
    expect(() => validateIdempotencyKey("", reqId)).toThrow(ApiError);
  });

  it("rejects idempotency keys shorter than 16 characters", () => {
    try {
      validateIdempotencyKey("short_key_123", reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_IDEMPOTENCY_KEY");
    }
  });

  it("rejects idempotency keys longer than 128 characters", () => {
    try {
      validateIdempotencyKey("x".repeat(129), reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("INVALID_IDEMPOTENCY_KEY");
    }
  });

  it("rejects keys with whitespace, newlines, or control characters", () => {
    const invalidWithSpace = "key with spaces 123456";
    const invalidWithNewline = "key\nwith\nnewline12345";
    const invalidWithTab = "key\twith\ttab1234567";

    expect(() => validateIdempotencyKey(invalidWithSpace, reqId)).toThrow(ApiError);
    expect(() => validateIdempotencyKey(invalidWithNewline, reqId)).toThrow(ApiError);
    expect(() => validateIdempotencyKey(invalidWithTab, reqId)).toThrow(ApiError);
  });

  it("derives deterministic 64-character lowercase hexadecimal SHA-256 request ID", () => {
    const orgId = "org-12345";
    const rawKey = "client-unique-key-abcdef-123456";

    const hash1 = deriveRequestId(orgId, rawKey);
    const hash2 = deriveRequestId(orgId, rawKey);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1.length).toBe(64);
  });

  it("ensures the same idempotency key across two different organizations yields different request IDs", () => {
    const rawKey = "identical-client-key-123456789";
    const orgA = "org-uuid-aaaaa";
    const orgB = "org-uuid-bbbbb";

    const hashA = deriveRequestId(orgA, rawKey);
    const hashB = deriveRequestId(orgB, rawKey);

    expect(hashA).not.toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashB).toMatch(/^[0-9a-f]{64}$/);
  });
});
