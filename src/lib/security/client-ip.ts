import "server-only";
import { isIP } from "node:net";
import { ApiError } from "@/lib/api/errors";

export interface ClientIpOptions {
  isProduction?: boolean;
  isVercel?: boolean;
}

/**
 * Parses and canonicalizes an IPv6 address string into standard RFC 5952 lowercase form.
 * Returns null if the string is not a valid IPv6 address.
 */
function canonicalizeIPv6(ipStr: string): string | null {
  const ip = ipStr.toLowerCase().trim();
  if (ip.length === 0 || ip.length > 128) return null;

  // Handle double colon count
  const doubleColonCount = (ip.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let leftParts: string[] = [];
  let rightParts: string[] = [];

  if (doubleColonCount === 1) {
    const [left, right] = ip.split("::");
    leftParts = left ? left.split(":") : [];
    rightParts = right ? right.split(":") : [];
  } else {
    leftParts = ip.split(":");
  }

  // Check if last part is an embedded IPv4 address (e.g. ::ffff:192.0.2.1)
  const lastPart =
    rightParts.length > 0 ? rightParts[rightParts.length - 1] : leftParts[leftParts.length - 1];
  let isEmbeddedIpv4 = false;
  let ipv4Words: number[] = [];

  if (lastPart && lastPart.includes(".")) {
    if (isIP(lastPart) !== 4) return null;
    const octets = lastPart.split(".").map(Number);
    if (octets.length !== 4 || octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
      return null;
    }
    isEmbeddedIpv4 = true;
    ipv4Words = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    if (rightParts.length > 0) rightParts.pop();
    else leftParts.pop();
  }

  const parseHex = (s: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(s)) return null;
    const val = parseInt(s, 16);
    return isNaN(val) || val < 0 || val > 0xffff ? null : val;
  };

  const leftWords: number[] = [];
  for (const p of leftParts) {
    const val = parseHex(p);
    if (val === null) return null;
    leftWords.push(val);
  }

  const rightWords: number[] = [];
  for (const p of rightParts) {
    const val = parseHex(p);
    if (val === null) return null;
    rightWords.push(val);
  }

  const totalKnownWords = leftWords.length + rightWords.length + (isEmbeddedIpv4 ? 2 : 0);
  let allWords: number[];

  if (doubleColonCount === 1) {
    if (totalKnownWords > 7) return null;
    const missingZeros = 8 - totalKnownWords;
    const middleZeros = new Array(missingZeros).fill(0);
    allWords = [...leftWords, ...middleZeros, ...rightWords, ...ipv4Words];
  } else {
    if (totalKnownWords !== 8) return null;
    allWords = [...leftWords, ...ipv4Words];
  }

  if (allWords.length !== 8) return null;

  // RFC 5952: Find the longest run of consecutive zeros (minimum 2 zeros)
  let longestZeroStart = -1;
  let longestZeroLen = 0;
  let currentZeroStart = -1;
  let currentZeroLen = 0;

  for (let i = 0; i < 8; i++) {
    if (allWords[i] === 0) {
      if (currentZeroStart === -1) {
        currentZeroStart = i;
        currentZeroLen = 1;
      } else {
        currentZeroLen++;
      }
      if (currentZeroLen > longestZeroLen) {
        longestZeroStart = currentZeroStart;
        longestZeroLen = currentZeroLen;
      }
    } else {
      currentZeroStart = -1;
      currentZeroLen = 0;
    }
  }

  // Only collapse if longest run is at least 2 zeros
  if (longestZeroLen < 2) {
    return allWords.map((w) => w.toString(16)).join(":");
  }

  const head = allWords.slice(0, longestZeroStart).map((w) => w.toString(16)).join(":");
  const tail = allWords.slice(longestZeroStart + longestZeroLen).map((w) => w.toString(16)).join(":");

  if (head === "" && tail === "") return "::";
  if (head === "") return `::${tail}`;
  if (tail === "") return `${head}::`;
  return `${head}::${tail}`;
}

/**
 * Validates and normalizes an IPv4 or IPv6 address into its canonical textual representation.
 * - IPv4: lowercase dotted-decimal with no leading zeros (e.g. 192.0.2.1).
 * - IPv6: lowercase RFC 5952 canonical format (e.g. 2001:db8::1).
 * Returns null if the address is invalid, malformed, or exceeds 128 characters.
 */
export function normalizeIp(rawIp: string): string | null {
  if (!rawIp || typeof rawIp !== "string") return null;
  const ip = rawIp.trim();
  if (ip.length === 0 || ip.length > 128) return null;

  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    const nums = parts.map((p) => Number(p));
    for (let i = 0; i < 4; i++) {
      if (isNaN(nums[i]) || nums[i] < 0 || nums[i] > 255 || String(nums[i]) !== parts[i]) {
        return null;
      }
    }
    return nums.join(".");
  }

  if (version === 6) {
    return canonicalizeIPv6(ip);
  }

  return null;
}

/**
 * Resolves and defensively validates the client IP address from inbound request headers.
 *
 * In Production:
 * - When deployed on Vercel (`process.env.VERCEL === "1"`), extracts client IP strictly
 *   from `x-vercel-forwarded-for`.
 * - In production outside Vercel, fails closed with 503 RATE_LIMIT_UNAVAILABLE because
 *   caller-provided headers (`x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`) cannot be trusted.
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
