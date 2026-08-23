import { Redis } from "@upstash/redis";

export interface RedisSafetyEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  REDIS_ENV?: string;
  RUN_REDIS_INTEGRATION_TESTS?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  DEVELOPMENT_REDIS_ENDPOINT_ID?: string;
  RATE_LIMIT_IDENTIFIER_SECRET?: string;
  [key: string]: string | undefined;
}

export interface ExtractedRedisEndpoint {
  endpointId: string;
  isValidUpstashHost: boolean;
}

/**
 * Extracts and normalizes the Upstash endpoint ID from a hostname.
 * Example:
 * - us1-super-duper-12345.upstash.io -> us1-super-duper-12345
 */
export function extractUpstashEndpointId(hostname: string): ExtractedRedisEndpoint {
  if (!hostname || typeof hostname !== "string" || !hostname.endsWith(".upstash.io")) {
    return { endpointId: "", isValidUpstashHost: false };
  }

  const parts = hostname.split(".");
  if (parts.length < 3) {
    return { endpointId: "", isValidUpstashHost: false };
  }

  return {
    endpointId: parts[0],
    isValidUpstashHost: true,
  };
}

/**
 * Validates that the provided environment matches all development Redis safety invariants.
 * Throws clean, redacted error messages if any check fails.
 */
export function validateDevelopmentRedisSafety(
  env: RedisSafetyEnv = process.env
): {
  endpointId: string;
  isDevelopmentVerified: true;
} {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    throw new Error(
      "Safety Check Failed: Refusing to run Redis tests in production environment (NODE_ENV or VERCEL_ENV is 'production')."
    );
  }

  if (env.RUN_REDIS_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Safety Check Failed: Integration Redis operations require explicit opt-in: RUN_REDIS_INTEGRATION_TESTS=true."
    );
  }

  if (env.REDIS_ENV !== "development") {
    throw new Error(
      "Safety Check Failed: Integration Redis operations require REDIS_ENV='development'."
    );
  }

  const restUrl = env.UPSTASH_REDIS_REST_URL;
  if (!restUrl || restUrl.trim() === "") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL is missing.");
  }

  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!token || token.trim() === "") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_TOKEN is missing.");
  }

  const expectedEndpointId = env.DEVELOPMENT_REDIS_ENDPOINT_ID;
  if (!expectedEndpointId || expectedEndpointId.trim() === "") {
    throw new Error("Safety Check Failed: DEVELOPMENT_REDIS_ENDPOINT_ID is missing.");
  }

  let parsed: URL;
  try {
    parsed = new URL(restUrl);
  } catch {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Safety Check Failed: UPSTASH_REDIS_REST_URL protocol must be https:, got '${parsed.protocol}'.`
    );
  }

  const endpoint = extractUpstashEndpointId(parsed.hostname);
  if (!endpoint.isValidUpstashHost) {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL hostname does not end with '.upstash.io'."
    );
  }

  if (endpoint.endpointId !== expectedEndpointId) {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL endpoint ID does not match pinned DEVELOPMENT_REDIS_ENDPOINT_ID."
    );
  }

  return {
    endpointId: expectedEndpointId,
    isDevelopmentVerified: true,
  };
}

export function assertRedisDevelopmentSafety(env: RedisSafetyEnv = process.env): void {
  validateDevelopmentRedisSafety(env);
}

/**
 * Lazy singleton instance for Redis client.
 * Does NOT instantiate at module import time.
 */
let cachedRedis: Redis | null = null;

export function getRedisClient(): Redis {
  if (cachedRedis) {
    return cachedRedis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || url.trim() === "" || !token || token.trim() === "") {
    throw new Error("Redis configuration missing: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("UPSTASH_REDIS_REST_URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:" && (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")) {
    throw new Error("UPSTASH_REDIS_REST_URL protocol must be https: in production.");
  }

  cachedRedis = new Redis({
    url,
    token,
  });

  return cachedRedis;
}
