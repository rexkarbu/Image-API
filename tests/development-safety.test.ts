import { describe, it, expect } from "vitest";
import {
  extractNeonEndpointId,
  validateDevelopmentDatabaseSafety,
  SafetyEnv,
} from "@/db/development-safety";

describe("Development Database Safety Guard (Pure Unit Tests)", () => {
  const validDevEndpoint = "ep-test-development-12345";
  const validPooledUrl = `postgresql://user:pass@${validDevEndpoint}-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
  const validDirectUrl = `postgresql://user:pass@${validDevEndpoint}.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;

  const createValidEnv = (): SafetyEnv => ({
    NODE_ENV: "development",
    VERCEL_ENV: "development",
    DATABASE_ENV: "development",
    RUN_DB_INTEGRATION_TESTS: "true",
    DATABASE_URL: validPooledUrl,
    DIRECT_DATABASE_URL: validDirectUrl,
    DEVELOPMENT_DATABASE_ENDPOINT_ID: validDevEndpoint,
  });

  describe("extractNeonEndpointId", () => {
    it("extracts endpoint ID and detects pooled hostname correctly", () => {
      const result = extractNeonEndpointId("ep-cool-forest-a1b2c3d4-pooler.c-3.ap-southeast-1.aws.neon.tech");
      expect(result).toEqual({
        endpointId: "ep-cool-forest-a1b2c3d4",
        isPooled: true,
        isValidNeonHost: true,
      });
    });

    it("extracts endpoint ID and detects direct hostname correctly", () => {
      const result = extractNeonEndpointId("ep-cool-forest-a1b2c3d4.c-3.ap-southeast-1.aws.neon.tech");
      expect(result).toEqual({
        endpointId: "ep-cool-forest-a1b2c3d4",
        isPooled: false,
        isValidNeonHost: true,
      });
    });

    it("rejects non-neon hostnames", () => {
      const result = extractNeonEndpointId("db.example.com");
      expect(result.isValidNeonHost).toBe(false);
      expect(result.endpointId).toBe("");
    });
  });

  describe("validateDevelopmentDatabaseSafety (Positive)", () => {
    it("passes when all parameters strictly match development safety invariants", () => {
      const env = createValidEnv();
      const result = validateDevelopmentDatabaseSafety(env);
      expect(result.isDevelopmentVerified).toBe(true);
      expect(result.endpointId).toBe(validDevEndpoint);
    });

    it("accepts postgres: protocol prefix as valid", () => {
      const env = createValidEnv();
      env.DATABASE_URL = `postgres://user:pass@${validDevEndpoint}-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
      env.DIRECT_DATABASE_URL = `postgres://user:pass@${validDevEndpoint}.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`;
      const result = validateDevelopmentDatabaseSafety(env);
      expect(result.isDevelopmentVerified).toBe(true);
    });
  });

  describe("validateDevelopmentDatabaseSafety (Negative / Fail-Closed)", () => {
    it("rejects when RUN_DB_INTEGRATION_TESTS is missing or not 'true'", () => {
      const env = createValidEnv();
      delete env.RUN_DB_INTEGRATION_TESTS;
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(/RUN_DB_INTEGRATION_TESTS=true/);

      env.RUN_DB_INTEGRATION_TESTS = "false";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(/RUN_DB_INTEGRATION_TESTS=true/);
    });

    it("rejects when DATABASE_ENV is not 'development'", () => {
      const env = createValidEnv();
      env.DATABASE_ENV = "production";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(/DATABASE_ENV='development'/);

      delete env.DATABASE_ENV;
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(/DATABASE_ENV='development'/);
    });

    it("rejects when NODE_ENV is 'production'", () => {
      const env = createValidEnv();
      env.NODE_ENV = "production";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(/production environment/);
    });

    it("rejects when VERCEL_ENV is 'production'", () => {
      const env = createValidEnv();
      env.VERCEL_ENV = "production";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(/production environment/);
    });

    it("rejects when DEVELOPMENT_DATABASE_ENDPOINT_ID is missing or empty", () => {
      const env = createValidEnv();
      delete env.DEVELOPMENT_DATABASE_ENDPOINT_ID;
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DEVELOPMENT_DATABASE_ENDPOINT_ID is missing/
      );

      env.DEVELOPMENT_DATABASE_ENDPOINT_ID = "";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DEVELOPMENT_DATABASE_ENDPOINT_ID is missing/
      );
    });

    it("rejects when DATABASE_URL has a different Neon endpoint ID", () => {
      const env = createValidEnv();
      env.DATABASE_URL = "postgresql://user:pass@ep-different-endpoint-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DATABASE_URL endpoint ID does not match pinned DEVELOPMENT_DATABASE_ENDPOINT_ID/
      );
    });

    it("rejects when DIRECT_DATABASE_URL has a different Neon endpoint ID", () => {
      const env = createValidEnv();
      env.DIRECT_DATABASE_URL = "postgresql://user:pass@ep-different-endpoint.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DIRECT_DATABASE_URL endpoint ID does not match pinned DEVELOPMENT_DATABASE_ENDPOINT_ID/
      );
    });

    it("rejects when DATABASE_URL and DIRECT_DATABASE_URL endpoints do not match each other", () => {
      const env = createValidEnv();
      env.DEVELOPMENT_DATABASE_ENDPOINT_ID = "ep-endpoint-a";
      env.DATABASE_URL = "postgresql://user:pass@ep-endpoint-a-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
      env.DIRECT_DATABASE_URL = "postgresql://user:pass@ep-endpoint-b.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow();
    });

    it("rejects when direct URL is used as the pooled runtime URL (missing -pooler)", () => {
      const env = createValidEnv();
      env.DATABASE_URL = validDirectUrl; // unpooled direct URL passed as runtime URL
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DATABASE_URL runtime connection must be pooled/
      );
    });

    it("rejects when pooled URL is used as the direct migration URL (has -pooler)", () => {
      const env = createValidEnv();
      env.DIRECT_DATABASE_URL = validPooledUrl; // pooled URL passed as migration URL
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DIRECT_DATABASE_URL migration connection must be non-pooled/
      );
    });

    it("rejects arbitrary or unknown hostnames even if other parameters match", () => {
      const env = createValidEnv();
      env.DATABASE_URL = "postgresql://user:pass@production-database.rds.amazonaws.com:5432/neondb";
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /DATABASE_URL hostname does not end with '\.neon\.tech'/
      );
    });

    it("rejects when database pathnames differ between runtime and migration URLs", () => {
      const env = createValidEnv();
      env.DIRECT_DATABASE_URL = `postgresql://user:pass@${validDevEndpoint}.c-3.ap-southeast-1.aws.neon.tech/otherdb?sslmode=require`;
      expect(() => validateDevelopmentDatabaseSafety(env)).toThrow(
        /point to different database paths/
      );
    });
  });
});
