import { describe, it, expect, vi } from "vitest";
import {
  resolveRequestId,
  sanitizeLogDetails,
  redactSensitiveString,
  createStructuredLog,
  logger,
} from "@/lib/observability/logger";

describe("Observability Logger & Request ID Sanitization Adversarial Tests", () => {
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
      expect(resolveRequestId("A".repeat(129))).toMatch(uuidRegex);
    });
  });

  describe("redactSensitiveString Sub-string Sanitization", () => {
    it("redacts credentials, URLs with params, and secrets embedded anywhere in strings", () => {
      const tests = [
        {
          name: "Bearer token in authorization header",
          input: "Authorization: Bearer img_live_abcdef1234567890",
          expectedNotToContain: "img_live_abcdef1234567890",
        },
        {
          name: "Stripe secret key in exception text",
          input: "Stripe error using key sk_test_51MockSecretKey1234567890",
          expectedNotToContain: "sk_test_51MockSecretKey1234567890",
        },
        {
          name: "Webhook signing secret in log",
          input: "Received webhook with signature whsec_abcdef1234567890 for customer",
          expectedNotToContain: "whsec_abcdef1234567890",
        },
        {
          name: "PostgreSQL connection string with credentials",
          input: "Database URL: postgresql://admin:secretPass123@ep-neon.tech/db?sslmode=verify-full",
          expectedNotToContain: "secretPass123",
        },
        {
          name: "Redis connection string with credentials",
          input: "Redis URL: rediss://default:redisToken999@us1.upstash.io:6379",
          expectedNotToContain: "redisToken999",
        },
        {
          name: "URL with embedded user:pass",
          input: "Fetch url: https://user:pass123@api.internal.net/sync",
          expectedNotToContain: "pass123",
        },
        {
          name: "URL with sensitive query parameters",
          input: "Redirecting to https://callback.net/oauth?token=my_secret_token_123&key=my_key_999&signature=sig_abc_123",
          expectedNotToContain: "my_secret_token_123",
        },
        {
          name: "Upstash REST token path",
          input: "Upstash endpoint: https://ap-southeast-1.upstash.io/AX34kldjfnv98347kldfjs893475",
          expectedNotToContain: "AX34kldjfnv98347kldfjs893475",
        },
        {
          name: "User email address",
          input: "Notification sent to user customer.support@company.org in tenant",
          expectedNotToContain: "customer.support@company.org",
        },
        {
          name: "Cookie header with session token",
          input: "Cookie header: session=sess_token_987654321; other=123",
          expectedNotToContain: "sess_token_987654321",
        },
        {
          name: "Raw 64-char hexadecimal secret / hash",
          input: "Secret key: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
          expectedNotToContain: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        },
      ];

      for (const t of tests) {
        const result = redactSensitiveString(t.input);
        expect(result).not.toContain(t.expectedNotToContain);
      }
    });
  });

  describe("Captured Serialized JSON Logs Secret Absence Proof", () => {
    it("proves that console output contains zero fixture secrets across nested objects, arrays, and thrown strings", () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      const fixtureSecrets = {
        apiKey: "img_live_super_secret_test_key_12345678",
        stripeSecret: "sk_test_51SecretStripeKey999888777",
        webhookSecret: "whsec_super_secret_webhook_signature_token",
        postgresUri: "postgres://neondb_owner:NeonSecretPassword123@ep-cold-lake.us-east-2.aws.neon.tech/neondb",
        redisUrlWithParam: "https://upstash.io/query?token=upstash_secret_token_abc&key=secret_key_123",
        userEmail: "ceo@enterprise-client.com",
        bearerToken: "Bearer img_live_super_secret_test_key_12345678",
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        cookie: "session=sess_secret_cookie_token_999",
        thrownString: "Fatal error on https://user:super_secret_pw@internal.db/sync",
      };

      logger.info("transform.completed", {
        requestId: "req-clean-12345",
        route: "/v1/images/transform",
        method: "POST",
        statusCode: 200,
        durationMs: 45,
        outcome: "success",
        details: {
          format: "webp",
          width: 800,
          height: 600,
          nested: {
            deep: {
              auth: fixtureSecrets.bearerToken,
              stripe: fixtureSecrets.stripeSecret,
              webhook: fixtureSecrets.webhookSecret,
              postgres: fixtureSecrets.postgresUri,
              redisQuery: fixtureSecrets.redisUrlWithParam,
              email: fixtureSecrets.userEmail,
              hash: fixtureSecrets.hash,
              cookie: fixtureSecrets.cookie,
              thrown: fixtureSecrets.thrownString,
            },
            arrayValues: [
              `Token ${fixtureSecrets.apiKey}`,
              fixtureSecrets.postgresUri,
              fixtureSecrets.userEmail,
            ],
          },
        },
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const loggedJsonString = consoleSpy.mock.calls[0][0];

      // Parse output as valid JSON
      const parsedLog = JSON.parse(loggedJsonString);
      expect(parsedLog.event).toBe("transform.completed");
      expect(parsedLog.service).toBe("image-api");
      expect(parsedLog.statusCode).toBe(200);
      expect(parsedLog.details.format).toBe("webp");
      expect(parsedLog.details.width).toBe(800);

      // Strictly assert that ZERO fixture secrets appear in the serialized JSON string
      expect(loggedJsonString).not.toContain("super_secret_test_key");
      expect(loggedJsonString).not.toContain("SecretStripeKey");
      expect(loggedJsonString).not.toContain("super_secret_webhook");
      expect(loggedJsonString).not.toContain("NeonSecretPassword123");
      expect(loggedJsonString).not.toContain("upstash_secret_token_abc");
      expect(loggedJsonString).not.toContain("secret_key_123");
      expect(loggedJsonString).not.toContain("ceo@enterprise-client.com");
      expect(loggedJsonString).not.toContain("sess_secret_cookie_token_999");
      expect(loggedJsonString).not.toContain("super_secret_pw");
      expect(loggedJsonString).not.toContain(fixtureSecrets.hash);

      consoleSpy.mockRestore();
    });
  });
});
