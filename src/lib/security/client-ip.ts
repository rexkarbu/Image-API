import "server-only";
import { normalizeIp } from "./rate-limit-core";
import { ApiError } from "@/lib/api/errors";

export interface ClientIpOptions {
  isProduction?: boolean;
  isVercel?: boolean;
}

export { normalizeIp };

/**
 * Resolves and defensively validates the client IP address from inbound request headers.
 *
 * In Production:
 * - When deployed on genuine Vercel (strictly requiring `process.env.VERCEL === "1"`),
 *   extracts client IP strictly from `x-vercel-forwarded-for`.
 * - In production outside Vercel, fails closed with 503 RATE_LIMIT_UNAVAILABLE because
 *   caller-provided headers (x-forwarded-for, x-real-ip, cf-connecting-ip, etc.) cannot be trusted.
 * - Fails closed with 503 RATE_LIMIT_UNAVAILABLE if trusted client IP is missing or malformed.
 *
 * In Development / Test:
 * - Allows `x-vercel-forwarded-for`, `x-forwarded-for`, or `x-real-ip` for local simulation.
 * - Falls back deterministically to loopback "127.0.0.1" if no valid header is present.
 */
export function resolveClientIp(
  request: Request,
  correlationId: string,
  options?: ClientIpOptions
): string {
  const isProduction =
    options?.isProduction ??
    (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production");

  const isVercel =
    options?.isVercel ??
    (process.env.VERCEL === "1");

  if (isProduction) {
    // Production outside Vercel: fail closed because x-forwarded-for is caller-controlled
    if (!isVercel) {
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    // Production on Vercel: trust ONLY x-vercel-forwarded-for
    const rawHeader = request.headers.get("x-vercel-forwarded-for");
    if (!rawHeader || rawHeader.trim() === "" || rawHeader.length > 128) {
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    // Defensive parsing: take the first IP in comma-separated list and canonicalize
    const candidate = rawHeader.split(",")[0].trim();
    const normalized = normalizeIp(candidate);

    if (!normalized) {
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    return normalized;
  }

  // Non-production (development / test / local loopback verification)
  const devHeader =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip");

  if (devHeader && devHeader.trim() !== "") {
    const candidate = devHeader.split(",")[0].trim();
    const normalized = normalizeIp(candidate);
    if (normalized) {
      return normalized;
    }
  }

  // Deterministic local loopback default
  return "127.0.0.1";
}
