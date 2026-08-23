/**
 * Development Database Safety Guard
 *
 * Enforces strict fail-closed verification before executing any destructive
 * integration tests or end-to-end database operations.
 *
 * Pinned strictly to the configured development database endpoint.
 * Refuses execution in production, unverified hosts, or mismatched configurations.
 */

import { validatePostgresUrlSecurity } from "./ssl-validation";

export { validatePostgresUrlSecurity };

export interface SafetyEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  DATABASE_ENV?: string;
  RUN_DB_INTEGRATION_TESTS?: string;
  DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
  DEVELOPMENT_DATABASE_ENDPOINT_ID?: string;
  [key: string]: string | undefined;
}

export interface ExtractedEndpoint {
  endpointId: string;
  isPooled: boolean;
  isValidNeonHost: boolean;
}

/**
 * Extracts and normalizes the Neon endpoint ID from a hostname.
 * Example:
 * - ep-billowing-fire-az2ks0b1-pooler.c-3.ap-southeast-1.aws.neon.tech -> ep-billowing-fire-az2ks0b1 (pooled: true)
 * - ep-billowing-fire-az2ks0b1.c-3.ap-southeast-1.aws.neon.tech -> ep-billowing-fire-az2ks0b1 (pooled: false)
 */
export function extractNeonEndpointId(hostname: string): ExtractedEndpoint {
  if (!hostname || typeof hostname !== "string" || !hostname.endsWith(".neon.tech")) {
    return { endpointId: "", isPooled: false, isValidNeonHost: false };
  }

  const parts = hostname.split(".");
  if (parts.length < 3) {
    return { endpointId: "", isPooled: false, isValidNeonHost: false };
  }

  const firstSegment = parts[0];
  const isPooled = firstSegment.endsWith("-pooler");
  const endpointId = isPooled ? firstSegment.slice(0, -7) : firstSegment;

  return {
    endpointId,
    isPooled,
    isValidNeonHost: true,
  };
}

/**
 * Validates that the provided environment matches all development database safety invariants.
 *
 * Throws clean, redacted error messages if any safety check fails.
 */
export function validateDevelopmentDatabaseSafety(
  env: SafetyEnv = process.env
): {
  endpointId: string;
  isDevelopmentVerified: true;
} {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error(
      "Safety Check Failed: Refusing to run database tests or operations in production environment (NODE_ENV or VERCEL_ENV is 'production')."
    );
  }

  if (env.RUN_DB_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Safety Check Failed: Integration database operations require explicit opt-in: RUN_DB_INTEGRATION_TESTS=true."
    );
  }

  if (env.DATABASE_ENV !== "development") {
    throw new Error(
      "Safety Check Failed: Integration database operations require DATABASE_ENV='development'."
    );
  }

  const dbUrl = env.DATABASE_URL;
  if (!dbUrl || dbUrl.trim() === "") {
    throw new Error("Safety Check Failed: DATABASE_URL is missing.");
  }

  const directUrl = env.DIRECT_DATABASE_URL;
  if (!directUrl || directUrl.trim() === "") {
    throw new Error("Safety Check Failed: DIRECT_DATABASE_URL is missing.");
  }

  const expectedEndpointId = env.DEVELOPMENT_DATABASE_ENDPOINT_ID;
  if (!expectedEndpointId || expectedEndpointId.trim() === "") {
    throw new Error(
      "Safety Check Failed: DEVELOPMENT_DATABASE_ENDPOINT_ID is missing."
    );
  }

  // 1. Enforce strict PostgreSQL TLS security validation
  validatePostgresUrlSecurity(dbUrl, "DATABASE_URL");
  validatePostgresUrlSecurity(directUrl, "DIRECT_DATABASE_URL");

  let parsedDb: URL;
  let parsedDirect: URL;
  try {
    parsedDb = new URL(dbUrl);
    parsedDirect = new URL(directUrl);
  } catch {
    throw new Error("Safety Check Failed: URL parsing error.");
  }

  const dbEndpoint = extractNeonEndpointId(parsedDb.hostname);
  const directEndpoint = extractNeonEndpointId(parsedDirect.hostname);

  if (!dbEndpoint.isValidNeonHost) {
    throw new Error(
      "Safety Check Failed: DATABASE_URL hostname does not end with '.neon.tech'."
    );
  }

  if (!directEndpoint.isValidNeonHost) {
    throw new Error(
      "Safety Check Failed: DIRECT_DATABASE_URL hostname does not end with '.neon.tech'."
    );
  }

  if (!dbEndpoint.isPooled) {
    throw new Error(
      "Safety Check Failed: DATABASE_URL runtime connection must be pooled (hostname prefix must end with '-pooler')."
    );
  }

  if (directEndpoint.isPooled) {
    throw new Error(
      "Safety Check Failed: DIRECT_DATABASE_URL migration connection must be non-pooled (hostname prefix must not end with '-pooler')."
    );
  }

  if (dbEndpoint.endpointId !== expectedEndpointId) {
    throw new Error(
      "Safety Check Failed: DATABASE_URL endpoint ID does not match pinned DEVELOPMENT_DATABASE_ENDPOINT_ID."
    );
  }

  if (directEndpoint.endpointId !== expectedEndpointId) {
    throw new Error(
      "Safety Check Failed: DIRECT_DATABASE_URL endpoint ID does not match pinned DEVELOPMENT_DATABASE_ENDPOINT_ID."
    );
  }

  if (dbEndpoint.endpointId !== directEndpoint.endpointId) {
    throw new Error(
      "Safety Check Failed: DATABASE_URL and DIRECT_DATABASE_URL endpoint IDs do not match each other."
    );
  }

  if (parsedDb.pathname !== parsedDirect.pathname) {
    throw new Error(
      "Safety Check Failed: DATABASE_URL and DIRECT_DATABASE_URL point to different database paths."
    );
  }

  return {
    endpointId: expectedEndpointId,
    isDevelopmentVerified: true,
  };
}

export function assertDevelopmentDatabaseSafety(env: SafetyEnv = process.env): void {
  validateDevelopmentDatabaseSafety(env);
}
