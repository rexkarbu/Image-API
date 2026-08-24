import { describe, it, expect } from "vitest";
import { resolveRequestId, sanitizeLogDetails } from "@/lib/observability/logger";

describe("Observability Logger & Request ID Sanitization Unit Tests", () => {
  describe("resolveRequestId", () => {
    it("accepts valid, bounded incoming X-Request-ID headers", () => {
      expect(resolveRequestId("req-12345")).toBe("req-12345");
      expect(resolveRequestId("trace_abc.123:foo-bar")).toBe("trace_abc.123:foo-bar");
      expect(resolveRequestId("A".repeat(128))).toBe("A".repeat(128));
    });

    it("generates a secure UUID for missing, empty, or whitespace headers", () => {
      const id1 = resolveRequestId(null);
      const id2 = resolveRequestId(undefined);
      const id3 = resolveRequestId("");
      const id4 = resolveRequestId("   ");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(id1).toMatch(uuidRegex);
      expect(id2).toMatch(uuidRegex);
      expect(id3).toMatch(uuidRegex);
      expect(id4).toMatch(uuidRegex);
    });

    it("rejects invalid characters, injection attempts, or oversized IDs", () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(resolveRequestId("req<script>alert(1)</script>")).toMatch(uuidRegex);
      expect(resolveRequestId("req 1234 invalid space")).toMatch(uuidRegex);
      expect(resolveRequestId("req$special!chars")).toMatch(uuidRegex);
      expect(resolveRequestId("A".repeat(129))).toMatch(uuidRegex); // exceeds 128 chars
    });
  });

  describe("sanitizeLogDetails", () => {
    it("redacts sensitive keys in objects", () => {
      const input = {
        apiKey: "img_live_mock123",
        secretToken: "secret_123",
        userEmail: "user@example.com",
        password: "supersecretpassword",
        authorization: "Bearer token",
        databaseUrl: "postgresql://user:pass@host/db",
        normalField: "safe-value",
        count: 42,
      };

      const sanitized = sanitizeLogDetails(input) as Record<string, unknown>;

      expect(sanitized.apiKey).toBe("[REDACTED]");
      expect(sanitized.secretToken).toBe("[REDACTED]");
      expect(sanitized.userEmail).toBe("[REDACTED]");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.authorization).toBe("[REDACTED]");
      expect(sanitized.databaseUrl).toBe("[REDACTED]");
      expect(sanitized.normalField).toBe("safe-value");
      expect(sanitized.count).toBe(42);
    });

    it("redacts credential strings by prefix even in non-sensitive keys", () => {
      const input = {
        meta: "img_live_some_secret_key",
        stripe: "sk_test_mock_secret",
        webhook: "whsec_mock_secret",
        conn: "postgres://user:pass@ep.neon.tech/db?sslmode=verify-full",
      };

      const sanitized = sanitizeLogDetails(input) as Record<string, unknown>;
      expect(sanitized.meta).toBe("[REDACTED_CREDENTIAL]");
      expect(sanitized.stripe).toBe("[REDACTED]");
      expect(sanitized.webhook).toBe("[REDACTED_CREDENTIAL]");
      expect(sanitized.conn).toBe("[REDACTED]");
    });

    it("handles nested arrays and objects recursively with depth limits", () => {
      const nested = {
        level1: {
          level2: {
            safe: "ok",
            apiKeyId: "key_123",
          },
          items: [{ key: "bad" }, { name: "good" }],
        },
      };

      const sanitized = sanitizeLogDetails(nested) as any;
      expect(sanitized.level1.level2.safe).toBe("ok");
      expect(sanitized.level1.level2.apiKeyId).toBe("[REDACTED]");
      expect(sanitized.level1.items[0].key).toBe("[REDACTED]");
      expect(sanitized.level1.items[1].name).toBe("good");
    });
  });
});
