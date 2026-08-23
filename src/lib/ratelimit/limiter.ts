import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getRedisClient } from "./redis-safety";
import { deriveIpIdentifier, deriveApiKeyIdentifier } from "@/lib/security/rate-limit-identifiers";
import { ApiError } from "@/lib/api/errors";

export interface RateLimitDecision {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in ms
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  redis?: Redis;
  secret?: string;
  ipLimiter?: Ratelimit;
  keyLimiter?: Ratelimit;
  timeoutMs?: number;
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

  const inTest = isTestEnv !== undefined ? isTestEnv : (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST));
  return inTest ? 4000 : DEFAULT_PROD_TIMEOUT_MS;
}

/**
 * Pure validator that strictly verifies the result structure from Upstash ratelimit.
 * Returns a validated result or null if the response is malformed, timed out, or unparseable.
 */
export function validateRateLimitResponse(
  raw: unknown,
  currentTimeMs: number = Date.now()
): ValidatedRateLimitResult | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const res = raw as Record<string, unknown>;

  // Upstash timeout reason fails closed
  if (res.reason === "timeout") {
    return null;
  }

  // Allowed SDK reasons: undefined, null, "", "cacheBlock", "cache"
  if (
    res.reason !== undefined &&
    res.reason !== null &&
    res.reason !== "" &&
    res.reason !== "cacheBlock" &&
    res.reason !== "cache"
  ) {
    return null;
  }

  if (typeof res.success !== "boolean") {
    return null;
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
    res.reset <= 0
  ) {
    return null;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((res.reset - currentTimeMs) / 1000));
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 1) {
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

// In-memory hot cache for blocked requests (non-authoritative)
const ephemeralCache = new Map<string, number>();

// Lazy singletons for production rate limiters
let globalIpLimiter: Ratelimit | null = null;
let globalKeyLimiter: Ratelimit | null = null;

export function getIpRateLimiter(customRedis?: Redis, timeoutMs?: number): Ratelimit {
  const timeout = getValidatedTimeout(timeoutMs);

  if (customRedis) {
    return new Ratelimit({
      redis: customRedis,
      limiter: Ratelimit.slidingWindow(120, "60 s"),
      prefix: "image-api:ratelimit:ip:v1",
      timeout,
      analytics: false,
      ephemeralCache,
    });
  }

  if (!globalIpLimiter) {
    globalIpLimiter = new Ratelimit({
      redis: getRedisClient(),
      limiter: Ratelimit.slidingWindow(120, "60 s"),
      prefix: "image-api:ratelimit:ip:v1",
      timeout,
      analytics: false,
      ephemeralCache,
    });
  }

  return globalIpLimiter;
}

export function getKeyRateLimiter(customRedis?: Redis, timeoutMs?: number): Ratelimit {
  const timeout = getValidatedTimeout(timeoutMs);

  if (customRedis) {
    return new Ratelimit({
      redis: customRedis,
      limiter: Ratelimit.tokenBucket(10, "10 s", 20),
      prefix: "image-api:ratelimit:key:v1",
      timeout,
      analytics: false,
      ephemeralCache,
    });
  }

  if (!globalKeyLimiter) {
    globalKeyLimiter = new Ratelimit({
      redis: getRedisClient(),
      limiter: Ratelimit.tokenBucket(10, "10 s", 20),
      prefix: "image-api:ratelimit:key:v1",
      timeout,
      analytics: false,
      ephemeralCache,
    });
  }

  return globalKeyLimiter;
}

/**
 * Executes pre-authentication IP rate limiting.
 * Policy: Sliding window of 120 requests per 60 seconds per HMAC-derived client IP.
 */
export async function checkIpRateLimit(
  clientIp: string,
  correlationId: string,
  options?: RateLimitOptions
): Promise<RateLimitDecision> {
  const category = "ip";
  let identifier: string;

  try {
    identifier = deriveIpIdentifier(clientIp, options?.secret);
  } catch {
    console.error(`[RateLimit Error] limiter=${category} correlationId=${correlationId}`);
    throw new ApiError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Rate limiting service temporarily unavailable. Please try again later.",
      correlationId
    );
  }

  try {
    const limiter = options?.ipLimiter || getIpRateLimiter(options?.redis, options?.timeoutMs);
    const rawRes = await limiter.limit(identifier);

    if (rawRes?.reason === "timeout") {
      console.error(`[RateLimit Timeout] limiter=${category} correlationId=${correlationId}`);
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    const validated = validateRateLimitResponse(rawRes);
    if (!validated) {
      console.error(`[RateLimit Validation Error] limiter=${category} correlationId=${correlationId}`);
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    if (!validated.success) {
      const headers: Record<string, string> = {
        "Retry-After": String(validated.retryAfterSeconds),
        "X-RateLimit-Limit": String(validated.limit),
        "X-RateLimit-Remaining": String(validated.remaining),
        "X-RateLimit-Reset": String(Math.ceil(validated.reset / 1000)),
      };

      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please retry later.",
        correlationId,
        headers
      );
    }

    return {
      success: true,
      limit: validated.limit,
      remaining: validated.remaining,
      reset: validated.reset,
      retryAfterSeconds: validated.retryAfterSeconds,
    };
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    console.error(`[RateLimit Error] limiter=${category} correlationId=${correlationId}`);
    throw new ApiError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Rate limiting service temporarily unavailable. Please try again later.",
      correlationId
    );
  }
}

/**
 * Executes authenticated API-key rate limiting.
 * Policy: Token bucket refilling 10 tokens every 10 seconds, capacity 20 tokens.
 */
export async function checkApiKeyRateLimit(
  organizationId: string,
  apiKeyId: string,
  correlationId: string,
  options?: RateLimitOptions
): Promise<RateLimitDecision> {
  const category = "key";
  let identifier: string;

  try {
    identifier = deriveApiKeyIdentifier(organizationId, apiKeyId, options?.secret);
  } catch {
    console.error(`[RateLimit Error] limiter=${category} correlationId=${correlationId}`);
    throw new ApiError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Rate limiting service temporarily unavailable. Please try again later.",
      correlationId
    );
  }

  try {
    const limiter = options?.keyLimiter || getKeyRateLimiter(options?.redis, options?.timeoutMs);
    const rawRes = await limiter.limit(identifier);

    if (rawRes?.reason === "timeout") {
      console.error(`[RateLimit Timeout] limiter=${category} correlationId=${correlationId}`);
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    const validated = validateRateLimitResponse(rawRes);
    if (!validated) {
      console.error(`[RateLimit Validation Error] limiter=${category} correlationId=${correlationId}`);
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    if (!validated.success) {
      const headers: Record<string, string> = {
        "Retry-After": String(validated.retryAfterSeconds),
        "X-RateLimit-Limit": String(validated.limit),
        "X-RateLimit-Remaining": String(validated.remaining),
        "X-RateLimit-Reset": String(Math.ceil(validated.reset / 1000)),
      };

      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please retry later.",
        correlationId,
        headers
      );
    }

    return {
      success: true,
      limit: validated.limit,
      remaining: validated.remaining,
      reset: validated.reset,
      retryAfterSeconds: validated.retryAfterSeconds,
    };
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    console.error(`[RateLimit Error] limiter=${category} correlationId=${correlationId}`);
    throw new ApiError(
      503,
      "RATE_LIMIT_UNAVAILABLE",
      "Rate limiting service temporarily unavailable. Please try again later.",
      correlationId
    );
  }
}
