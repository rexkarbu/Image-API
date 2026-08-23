import "server-only";
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
 * Validates that an Upstash REST URL adheres to all security and syntax rules:
 * - Must use https: protocol in all environments.
 * - Must have a valid .upstash.io hostname.
 * - Must not contain username, password, query parameters, URL fragments, or arbitrary paths.
 * Never prints or leaks the URL in error messages.
 */
export function validateUpstashRestUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL protocol must be https: in all environments.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain embedded user credentials.");
  }

  if (parsed.search && parsed.search !== "") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain query parameters.");
  }

  if (parsed.hash && parsed.hash !== "") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain URL fragments.");
  }

  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain a path component.");
  }

  const endpoint = extractUpstashEndpointId(parsed.hostname);
  if (!endpoint.isValidUpstashHost) {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL hostname must end with '.upstash.io'.");
  }

  return parsed;
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

  const parsed = validateUpstashRestUrl(restUrl);
  const endpoint = extractUpstashEndpointId(parsed.hostname);

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

  validateUpstashRestUrl(url);

  cachedRedis = new Redis({
    url,
    token,
  });

  return cachedRedis;
}
