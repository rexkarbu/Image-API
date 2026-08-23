import { isIP } from "node:net";
import { ApiError } from "@/lib/api/errors";

export interface ClientIpOptions {
  isProduction?: boolean;
  isVercel?: boolean;
}

/**
 * Resolves and defensively validates the client IP address from inbound request headers.
 *
 * In Production:
 * - When deployed on Vercel, extracts client IP strictly from `x-vercel-forwarded-for`.
 * - Does NOT trust caller-controlled `x-forwarded-for` or `x-real-ip` headers.
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
    (process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV));

  if (isProduction) {
    // On Vercel in production, x-vercel-forwarded-for is set by the edge infrastructure
    const rawHeader = isVercel
      ? request.headers.get("x-vercel-forwarded-for")
      : request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for");

    if (!rawHeader || rawHeader.trim() === "" || rawHeader.length > 128) {
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    // Defensive parsing: take the first IP in comma-separated list
    const candidate = rawHeader.split(",")[0].trim();
    if (!candidate || candidate.length > 128 || !isIP(candidate)) {
      throw new ApiError(
        503,
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting service temporarily unavailable. Please try again later.",
        correlationId
      );
    }

    return candidate.toLowerCase();
  }

  // Non-production (development / test / local loopback verification)
  const devHeader =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip");

  if (devHeader && devHeader.trim() !== "") {
    const candidate = devHeader.split(",")[0].trim();
    if (candidate.length <= 128 && isIP(candidate)) {
      return candidate.toLowerCase();
    }
  }

  // Deterministic local loopback default
  return "127.0.0.1";
}
