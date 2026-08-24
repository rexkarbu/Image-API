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

export interface ValidatedRateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfterSeconds: number;
}

const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 5000;
const DEFAULT_PROD_TIMEOUT_MS = 2500;

/**
 * Validates and clamps rate limiter timeout within safe bounds [500ms, 5000ms].
 */
export function getValidatedTimeout(
  explicitTimeout?: number,
  isTestEnv?: boolean
): number {
  if (explicitTimeout !== undefined) {
    if (
      typeof explicitTimeout === "number" &&
      Number.isFinite(explicitTimeout) &&
      Number.isInteger(explicitTimeout) &&
      explicitTimeout >= MIN_TIMEOUT_MS &&
      explicitTimeout <= MAX_TIMEOUT_MS
    ) {
      return explicitTimeout;
    }
  }

  if (process.env.UPSTASH_REDIS_TIMEOUT_MS) {
    const parsed = Number(process.env.UPSTASH_REDIS_TIMEOUT_MS);
    if (
      Number.isFinite(parsed) &&
      Number.isInteger(parsed) &&
      parsed >= MIN_TIMEOUT_MS &&
      parsed <= MAX_TIMEOUT_MS
    ) {
      return parsed;
    }
  }

  const inTest =
    isTestEnv !== undefined
      ? isTestEnv
      : process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  return inTest ? 4000 : DEFAULT_PROD_TIMEOUT_MS;
}

/**
 * Pure validator that strictly verifies the result structure from Upstash ratelimit.
 * Returns a validated result or null if the response is malformed, timed out, or unparseable.
 *
 * Rules:
 * - success must be boolean.
 * - limit must be a finite positive integer.
 * - remaining must be a finite integer in [0, limit].
 * - reset must be a finite positive integer in milliseconds.
 * - reason === "timeout" fails closed (returns null).
 * - reason === "cacheBlock" is allowed ONLY with success === false.
 * - reason === undefined is allowed.
 * - Any other reason value (null, "", "cache", "denyList", or unknown string) fails closed (returns null).
 */
export function validateRateLimitResponse(
  raw: unknown,
  currentTimeMs: number = Date.now()
): ValidatedRateLimitResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const res = raw as Record<string, unknown>;

  if (typeof res.success !== "boolean") {
    return null;
  }

  // Reason checks: only undefined or ("cacheBlock" with success === false) are accepted
  if (res.reason !== undefined) {
    if (res.reason === "cacheBlock") {
      if (res.success !== false) {
        return null;
      }
    } else {
      // "timeout", null, "", "cache", "denyList", or any arbitrary string fails closed
      return null;
    }
  }

  if (
    typeof res.limit !== "number" ||
    !Number.isFinite(res.limit) ||
    !Number.isInteger(res.limit) ||
    res.limit <= 0
  ) {
    return null;
  }

  if (
    typeof res.remaining !== "number" ||
    !Number.isFinite(res.remaining) ||
    !Number.isInteger(res.remaining) ||
    res.remaining < 0 ||
    res.remaining > res.limit
  ) {
    return null;
  }

  if (
    typeof res.reset !== "number" ||
    !Number.isFinite(res.reset) ||
    !Number.isInteger(res.reset) ||
    res.reset <= 0
  ) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((res.reset - currentTimeMs) / 1000));
  if (
    !Number.isFinite(retryAfterSeconds) ||
    !Number.isInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1
  ) {
    return null;
  }

  return {
    success: res.success,
    limit: res.limit,
    remaining: res.remaining,
    reset: res.reset,
    retryAfterSeconds,
  };
}

/**
 * Extracts and normalizes the Upstash endpoint ID from a hostname.
 * Example: us1-super-duper-12345.upstash.io -> us1-super-duper-12345
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
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL protocol must be https: in all environments."
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain embedded user credentials."
    );
  }

  if (parsed.search && parsed.search !== "") {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain query parameters."
    );
  }

  if (parsed.hash && parsed.hash !== "") {
    throw new Error("Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain URL fragments.");
  }

  if (parsed.pathname && parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL must not contain a path component."
    );
  }

  const endpoint = extractUpstashEndpointId(parsed.hostname);
  if (!endpoint.isValidUpstashHost) {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL hostname must end with '.upstash.io'."
    );
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

export function getValidatedRedisConfig(env: RedisSafetyEnv = process.env): {
  restUrl: string;
  restToken: string;
} {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || url.trim() === "" || !token || token.trim() === "") {
    throw new Error(
      "Safety Check Failed: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required."
    );
  }

  validateUpstashRestUrl(url);

  return {
    restUrl: url,
    restToken: token,
  };
}

export function assertRedisDevelopmentSafety(env: RedisSafetyEnv = process.env): void {
  validateDevelopmentRedisSafety(env);
}
