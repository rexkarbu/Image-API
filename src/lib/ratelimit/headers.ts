import { RateLimitDecision } from "./limiter";

/**
 * Builds safe rate-limit headers to return in successful responses.
 * Informs clients of their current quota and reset timestamp.
 */
export function buildRateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.reset / 1000)),
  };
}
