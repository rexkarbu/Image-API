import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { assertRedisDevelopmentSafety, getRedisClient } from "@/lib/ratelimit/redis-safety";
import { deriveIpIdentifier, deriveApiKeyIdentifier } from "@/lib/security/rate-limit-identifiers";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "node:crypto";

describe("Live Upstash Redis Rate Limiting Integration Tests", () => {
  const testRunId = crypto.randomUUID().slice(0, 8);
  const testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const trackedCleanups: { limiter: Ratelimit; identifier: string }[] = [];

  beforeAll(() => {
    assertRedisDevelopmentSafety();
  });

  afterAll(async () => {
    // Official fail-closed cleanup using limiter.resetUsedTokens() without guessing key layouts
    for (const item of trackedCleanups) {
      await item.limiter.resetUsedTokens(item.identifier);
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
    trackedCleanups.push({ limiter, identifier });

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
    trackedCleanups.push({ limiter, identifier });

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
    trackedCleanups.push({ limiter: limiterInstance1, identifier });

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
    trackedCleanups.push({ limiter, identifier });

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

    const sharedIp = "192.0.2.100";
    const ipId = deriveIpIdentifier(sharedIp, testSecret);
    const keyId = deriveApiKeyIdentifier(sharedIp, "dummy-key-id", testSecret);

    trackedCleanups.push({ limiter, identifier: ipId });
    trackedCleanups.push({ limiter, identifier: keyId });

    // Exhaust IP identifier
    const ipRes = await limiter.limit(ipId);
    expect(ipRes.success).toBe(true);

    const ipRes2 = await limiter.limit(ipId);
    expect(ipRes2.success).toBe(false);

    // Key identifier must still be fresh (1 token available)
    const keyRes = await limiter.limit(keyId);
    expect(keyRes.success).toBe(true);
  });

  it("proves exact cleanup restores full initial allowance for sliding-window and token-bucket algorithms", async () => {
    const redis = getRedisClient();

    // 1. Sliding Window Cleanup Verification
    const swPrefix = `test-cleanup-sw:${testRunId}`;
    const swLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(2, "30 s"),
      prefix: swPrefix,
      analytics: false,
    });

    const swIp = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const swId = deriveIpIdentifier(swIp, testSecret);

    // Consume 1 token
    const sw1 = await swLimiter.limit(swId);
    expect(sw1.success).toBe(true);
    expect(sw1.remaining).toBe(1);

    // Reset via official API
    await swLimiter.resetUsedTokens(swId);

    // Verify full initial allowance is restored (remaining is back to 1)
    const swRestored = await swLimiter.limit(swId);
    expect(swRestored.success).toBe(true);
    expect(swRestored.remaining).toBe(1);

    // Final reset
    await swLimiter.resetUsedTokens(swId);

    // 2. Token Bucket Cleanup Verification
    const tbPrefix = `test-cleanup-tb:${testRunId}`;
    const tbLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.tokenBucket(2, "30 s", 2),
      prefix: tbPrefix,
      analytics: false,
    });

    const tbId = deriveApiKeyIdentifier("org-cleanup-test", crypto.randomUUID(), testSecret);

    // Consume 1 token
    const tb1 = await tbLimiter.limit(tbId);
    expect(tb1.success).toBe(true);
    expect(tb1.remaining).toBe(1);

    // Reset via official API
    await tbLimiter.resetUsedTokens(tbId);

    // Verify full initial allowance is restored (remaining is back to 1)
    const tbRestored = await tbLimiter.limit(tbId);
    expect(tbRestored.success).toBe(true);
    expect(tbRestored.remaining).toBe(1);

    // Final reset
    await tbLimiter.resetUsedTokens(tbId);
  });
});
