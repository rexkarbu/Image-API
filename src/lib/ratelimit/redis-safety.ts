import "server-only";
import { Redis } from "@upstash/redis";
import {
  validateUpstashRestUrl,
  validateDevelopmentRedisSafety,
  assertRedisDevelopmentSafety,
  extractUpstashEndpointId,
  getValidatedRedisConfig,
  type RedisSafetyEnv,
  type ExtractedRedisEndpoint,
} from "./redis-safety-core";

export {
  validateUpstashRestUrl,
  validateDevelopmentRedisSafety,
  assertRedisDevelopmentSafety,
  extractUpstashEndpointId,
  getValidatedRedisConfig,
  type RedisSafetyEnv,
  type ExtractedRedisEndpoint,
};

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
    throw new Error(
      "Redis configuration missing: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required."
    );
  }

  validateUpstashRestUrl(url);

  cachedRedis = new Redis({
    url,
    token,
  });

  return cachedRedis;
}
