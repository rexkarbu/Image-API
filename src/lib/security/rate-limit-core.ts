import crypto from "node:crypto";
import { isIP } from "node:net";

const EXACT_HEX_64_REGEX = /^[0-9a-f]{64}$/;

const KNOWN_PLACEHOLDER_SUBSTRINGS = [
  "replace",
  "placeholder",
  "insecure",
  "example",
  "development-",
];

/**
 * Parses and canonicalizes an IPv6 address string into standard RFC 5952 lowercase form.
 * Returns null if the string is not a valid IPv6 address.
 */
export function canonicalizeIPv6(ipStr: string): string | null {
  if (!ipStr || typeof ipStr !== "string") return null;
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
 * Validates that the provided HMAC secret adheres to the strict 32-byte lowercase hexadecimal contract.
 * Selected value is: explicitSecret !== undefined ? explicitSecret : process.env.RATE_LIMIT_IDENTIFIER_SECRET
 * Validates the original raw string WITHOUT .trim().
 * Rejects non-hex, uppercase, wrong length, whitespace, empty, all-zero, or placeholder values fail-closed.
 * Never logs or prints the secret.
 */
export function validateRateLimitSecret(explicitSecret?: string): string {
  const secret =
    explicitSecret !== undefined
      ? explicitSecret
      : process.env.RATE_LIMIT_IDENTIFIER_SECRET;

  if (typeof secret !== "string" || !EXACT_HEX_64_REGEX.test(secret)) {
    throw new Error(
      "Security Check Failed: RATE_LIMIT_IDENTIFIER_SECRET must be exactly 64 lowercase hexadecimal characters."
    );
  }

  // Reject all-zero placeholder
  if (/^0{64}$/.test(secret)) {
    throw new Error(
      "Security Check Failed: RATE_LIMIT_IDENTIFIER_SECRET cannot be an all-zero placeholder."
    );
  }

  const lower = secret.toLowerCase();
  for (const placeholder of KNOWN_PLACEHOLDER_SUBSTRINGS) {
    if (lower.includes(placeholder)) {
      throw new Error(
        "Security Check Failed: RATE_LIMIT_IDENTIFIER_SECRET cannot be an unconfigured placeholder."
      );
    }
  }

  return secret;
}

/**
 * Derives a privacy-preserving, domain-separated HMAC-SHA-256 identifier for an IP address.
 * Domain separation prefix: "ip\0"
 * Normalizes IPv4 and IPv6 representations to guarantee invariant canonical buckets.
 */
export function deriveIpIdentifier(clientIp: string, secret?: string): string {
  if (!clientIp || typeof clientIp !== "string" || clientIp.trim() === "") {
    throw new Error("Cannot derive rate limit identifier: clientIp is empty.");
  }

  const normalizedIp = normalizeIp(clientIp.trim());
  if (!normalizedIp) {
    throw new Error("Cannot derive rate limit identifier: clientIp is not a valid IP address.");
  }

  const hmacSecret = validateRateLimitSecret(secret);
  const payload = `ip\0${normalizedIp}`;

  return crypto.createHmac("sha256", hmacSecret).update(payload).digest("hex");
}

/**
 * Derives a privacy-preserving, domain-separated HMAC-SHA-256 identifier for an authenticated API key.
 * Domain separation prefix: "key\0"
 */
export function deriveApiKeyIdentifier(
  organizationId: string,
  apiKeyId: string,
  secret?: string
): string {
  if (!organizationId || typeof organizationId !== "string" || organizationId.trim() === "") {
    throw new Error("Cannot derive rate limit identifier: organizationId is empty.");
  }
  if (!apiKeyId || typeof apiKeyId !== "string" || apiKeyId.trim() === "") {
    throw new Error("Cannot derive rate limit identifier: apiKeyId is empty.");
  }

  const hmacSecret = validateRateLimitSecret(secret);
  const payload = `key\0${organizationId.trim()}\0${apiKeyId.trim()}`;

  return crypto.createHmac("sha256", hmacSecret).update(payload).digest("hex");
}
