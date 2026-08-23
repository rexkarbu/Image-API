import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { assertRedisDevelopmentSafety, getRedisClient } from "@/lib/ratelimit/redis-safety";
import { deriveIpIdentifier, deriveApiKeyIdentifier } from "@/lib/security/rate-limit-identifiers";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "node:crypto";

describe("Live Upstash Redis Rate Limiting Integration Tests", () => {
  const testRunId = crypto.randomUUID().slice(0, 8);
  const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const createdKeys: string[] = [];

  beforeAll(() => {
    assertRedisDevelopmentSafety();
  });

  afterAll(async () => {
    const redis = getRedisClient();
    // Strict fail-closed cleanup: delete ONLY exact recorded test keys
    for (const key of createdKeys) {
      try {
        await redis.del(key);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("allows initial request and decrements remaining tokens in real Upstash Redis", async () => {
    const redis = getRedisClient();
    const prefix = `test-ip:${testRunId}`;
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "30 s"),
      prefix,
      analytics: false,
    });

    const testIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const identifier = deriveIpIdentifier(testIp, testSecret);
    const redisKey = `${prefix}:${identifier}`;
    createdKeys.push(redisKey);

    const res = await limiter.limit(identifier);
    expect(res.success).toBe(true);
    expect(res.limit).toBe(5);
    expect(res.remaining).toBe(4);
    expect(res.reset).toBeGreaterThan(Date.now());
  });

  it("denies requests once burst quota is exhausted in real Upstash Redis", async () => {
    const redis = getRedisClient();
    const prefix = `test-exhaust:${testRunId}`;
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.tokenBucket(2, "30 s", 2),
      prefix,
      analytics: false,
    });

    const testKeyId = crypto.randomUUID();
    const identifier = deriveApiKeyIdentifier("org-test", testKeyId, testSecret);
    const redisKey = `${prefix}:${identifier}`;
    createdKeys.push(redisKey);

    // Consume 2 tokens
    const r1 = await limiter.limit(identifier);
    const r2 = await limiter.limit(identifier);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // 3rd token must be rejected
    const r3 = await limiter.limit(identifier);
    expect(r3.success).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("shares state across separately instantiated limiter instances (distributed consistency)", async () => {
    const redis = getRedisClient();
    const prefix = `test-shared:${testRunId}`;

    const limiterInstance1 = new Ratelimit({
      redis,
      limiter: Ratelimit.tokenBucket(5, "30 s", 5),
      prefix,
      analytics: false,
    });

    const limiterInstance2 = new Ratelimit({
      redis,
      limiter: Ratelimit.tokenBucket(5, "30 s", 5),
      prefix,
      analytics: false,
    });

    const testKeyId = crypto.randomUUID();
    const identifier = deriveApiKeyIdentifier("org-test-shared", testKeyId, testSecret);
    const redisKey = `${prefix}:${identifier}`;
    createdKeys.push(redisKey);

    const res1 = await limiterInstance1.limit(identifier);
    expect(res1.success).toBe(true);
    expect(res1.remaining).toBe(4);

    // Instance 2 queries same identifier -> should see remaining = 3
    const res2 = await limiterInstance2.limit(identifier);
    expect(res2.success).toBe(true);
    expect(res2.remaining).toBe(3);
  });

  it("enforces burst limit correctly under concurrent requests", async () => {
    const redis = getRedisClient();
    const prefix = `test-concurrent:${testRunId}`;
    const capacity = 5;
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.tokenBucket(1, "60 s", capacity),
      prefix,
      analytics: false,
    });

    const testKeyId = crypto.randomUUID();
    const identifier = deriveApiKeyIdentifier("org-concurrent", testKeyId, testSecret);
    const redisKey = `${prefix}:${identifier}`;
    createdKeys.push(redisKey);

    // Launch 10 concurrent requests for a capacity of 5
    const promises = Array.from({ length: 10 }).map(() => limiter.limit(identifier));
    const results = await Promise.all(promises);

    const allowedCount = results.filter((r) => r.success).length;
    const deniedCount = results.filter((r) => !r.success).length;

    expect(allowedCount).toBe(capacity);
    expect(deniedCount).toBe(5);
  });

  it("guarantees IP and API-key identifier domains do not collide", async () => {
    const redis = getRedisClient();
    const prefix = `test-domain:${testRunId}`;
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.tokenBucket(1, "30 s", 1),
      prefix,
      analytics: false,
    });

    const sharedString = "collision-test-string";
    const ipId = deriveIpIdentifier(sharedString, testSecret);
    const keyId = deriveApiKeyIdentifier(sharedString, "dummy", testSecret);

    createdKeys.push(`${prefix}:${ipId}`);
    createdKeys.push(`${prefix}:${keyId}`);

    // Exhaust IP identifier
    const ipRes = await limiter.limit(ipId);
    expect(ipRes.success).toBe(true);

    const ipRes2 = await limiter.limit(ipId);
    expect(ipRes2.success).toBe(false);

    // Key identifier must still be fresh (1 token available)
    const keyRes = await limiter.limit(keyId);
    expect(keyRes.success).toBe(true);
  });
});
