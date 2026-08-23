import { describe, it, expect } from "vitest";
import { validatePostgresUrlSecurity } from "@/db/ssl-validation";

describe("PostgreSQL SSL Security & Forward-Compatibility Validation", () => {
  const validNeonPooledUrl =
    "postgresql://myuser:mypassword123@ep-cool-forest-a1b2c3d4-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full";
  const validNeonDirectUrl =
    "postgres://myuser:mypassword123@ep-cool-forest-a1b2c3d4.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require";

  describe("Accepted Configurations", () => {
    it("accepts remote Neon connection string with exact sslmode=verify-full", () => {
      const result = validatePostgresUrlSecurity(validNeonPooledUrl, "DATABASE_URL");
      expect(result.isValid).toBe(true);
      expect(result.isLocal).toBe(false);
      expect(result.sslmode).toBe("verify-full");
    });

    it("accepts remote Neon connection with additional safe parameters like channel_binding", () => {
      const result = validatePostgresUrlSecurity(validNeonDirectUrl, "DIRECT_DATABASE_URL");
      expect(result.isValid).toBe(true);
      expect(result.isLocal).toBe(false);
      expect(result.sslmode).toBe("verify-full");
    });

    it("accepts localhost development placeholder without requiring TLS", () => {
      const localUrl = "postgres://postgres:postgres@localhost:5432/image_api_db";
      const result = validatePostgresUrlSecurity(localUrl, "DATABASE_URL");
      expect(result.isValid).toBe(true);
      expect(result.isLocal).toBe(true);
      expect(result.sslmode).toBeNull();
    });

    it("accepts 127.0.0.1 development placeholder without requiring TLS", () => {
      const loopbackUrl = "postgresql://postgres:postgres@127.0.0.1:5432/image_api_db";
      const result = validatePostgresUrlSecurity(loopbackUrl, "DATABASE_URL");
      expect(result.isValid).toBe(true);
      expect(result.isLocal).toBe(true);
    });

    it("accepts local connection with explicit sslmode=disable or verify-full", () => {
      const localDisabled = "postgres://postgres:postgres@localhost:5432/image_api_db?sslmode=disable";
      expect(validatePostgresUrlSecurity(localDisabled, "DATABASE_URL").isValid).toBe(true);

      const localVerifyFull = "postgres://postgres:postgres@localhost:5432/image_api_db?sslmode=verify-full";
      expect(validatePostgresUrlSecurity(localVerifyFull, "DATABASE_URL").isValid).toBe(true);
    });
  });

  describe("Rejected Configurations (Fail-Closed)", () => {
    it("rejects deprecated/weak sslmode=require on remote connection", () => {
      const weakUrl =
        "postgresql://user:pass@ep-cool-forest-a1b2c3d4-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
      expect(() => validatePostgresUrlSecurity(weakUrl, "DATABASE_URL")).toThrow(
        /uses deprecated or weak sslmode 'require'\. Must be strictly 'sslmode=verify-full'/
      );
    });

    it("rejects weak sslmode=prefer, verify-ca, allow, disable on remote connections", () => {
      const modes = ["prefer", "verify-ca", "allow", "disable", "no-verify"];
      for (const mode of modes) {
        const url = `postgresql://user:pass@ep-test.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=${mode}`;
        expect(() => validatePostgresUrlSecurity(url, "DATABASE_URL")).toThrow(
          /Must be strictly 'sslmode=verify-full'/
        );
      }
    });

    it("rejects remote connection when sslmode parameter is completely missing", () => {
      const noSslUrl =
        "postgresql://user:pass@ep-cool-forest-a1b2c3d4-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb";
      expect(() => validatePostgresUrlSecurity(noSslUrl, "DATABASE_URL")).toThrow(
        /requires explicit 'sslmode=verify-full'/
      );
    });

    it("rejects duplicate sslmode parameters", () => {
      const duplicateSsl =
        "postgresql://user:pass@ep-test.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&sslmode=verify-full";
      expect(() => validatePostgresUrlSecurity(duplicateSsl, "DATABASE_URL")).toThrow(
        /contains duplicate 'sslmode' parameters/
      );
    });

    it("rejects uselibpqcompat compatibility parameter", () => {
      const compatUrl =
        "postgresql://user:pass@ep-test.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&uselibpqcompat=true";
      expect(() => validatePostgresUrlSecurity(compatUrl, "DATABASE_URL")).toThrow(
        /must not use 'uselibpqcompat'/
      );
    });

    it("rejects conflicting ssl=false or ssl=disable parameter", () => {
      const conflictingUrl =
        "postgresql://user:pass@ep-test.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&ssl=false";
      expect(() => validatePostgresUrlSecurity(conflictingUrl, "DATABASE_URL")).toThrow(
        /contains ambiguous or conflicting 'ssl' parameter/
      );
    });

    it("rejects missing, empty, or whitespace URL", () => {
      expect(() => validatePostgresUrlSecurity(undefined, "DATABASE_URL")).toThrow(/is missing/);
      expect(() => validatePostgresUrlSecurity("", "DATABASE_URL")).toThrow(/is missing/);
      expect(() => validatePostgresUrlSecurity("   ", "DATABASE_URL")).toThrow(/is missing/);
    });

    it("rejects non-postgres protocols", () => {
      expect(() =>
        validatePostgresUrlSecurity("https://example.com/db?sslmode=verify-full", "DATABASE_URL")
      ).toThrow(/protocol must be postgres: or postgresql:/);
      expect(() =>
        validatePostgresUrlSecurity("mysql://user:pass@localhost:3306/db", "DATABASE_URL")
      ).toThrow(/protocol must be postgres: or postgresql:/);
    });

    it("never exposes credentials or raw connection strings in error messages", () => {
      const sensitivePassword = "SUPER_SECRET_PASSWORD_12345";
      const sensitiveUrl = `postgresql://admin:${sensitivePassword}@ep-test.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;

      try {
        validatePostgresUrlSecurity(sensitiveUrl, "DATABASE_URL");
        expect.unreachable("Should have thrown error");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toContain(sensitivePassword);
        expect(message).not.toContain("SUPER_SECRET");
        expect(message).not.toContain("admin:");
      }
    });
  });
});
