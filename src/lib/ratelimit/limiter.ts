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

function getTimeout(explicitTimeout?: number): number {
  if (explicitTimeout !== undefined) {
    return explicitTimeout;
  }
  if (process.env.UPSTASH_REDIS_TIMEOUT_MS) {
    const parsed = Number(process.env.UPSTASH_REDIS_TIMEOUT_MS);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Allow 4000ms in development/test environments to accommodate Next.js cold compilation; 2500ms in production.
  return process.env.NODE_ENV === "production" ? 2500 : 4000;
}

// In-memory hot cache for blocked requests (non-authoritative)
const ephemeralCache = new Map<string, number>();

// Lazy singletons for production rate limiters
let globalIpLimiter: Ratelimit | null = null;
let globalKeyLimiter: Ratelimit | null = null;

export function getIpRateLimiter(customRedis?: Redis, timeoutMs?: number): Ratelimit {
  const timeout = getTimeout(timeoutMs);

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
  const timeout = getTimeout(timeoutMs);

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
    const res = await limiter.limit(identifier);

    // Fail closed on Upstash timeout
    if (res.reason === "timeout") {
      console.error(`[RateLimit Timeout] limiter=${category} correlationId=${correlationId}`);
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    const now = Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil((res.reset - now) / 1000));

    if (!res.success) {
      const headers: Record<string, string> = {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(res.limit),
        "X-RateLimit-Remaining": String(res.remaining),
        "X-RateLimit-Reset": String(Math.ceil(res.reset / 1000)),
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
      limit: res.limit,
      remaining: res.remaining,
      reset: res.reset,
      retryAfterSeconds,
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
    const res = await limiter.limit(identifier);

    // Fail closed on Upstash timeout
    if (res.reason === "timeout") {
      console.error(`[RateLimit Timeout] limiter=${category} correlationId=${correlationId}`);
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    const now = Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil((res.reset - now) / 1000));

    if (!res.success) {
      const headers: Record<string, string> = {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(res.limit),
        "X-RateLimit-Remaining": String(res.remaining),
        "X-RateLimit-Reset": String(Math.ceil(res.reset / 1000)),
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
      limit: res.limit,
      remaining: res.remaining,
      reset: res.reset,
      retryAfterSeconds,
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
