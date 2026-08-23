import "server-only";
import crypto from "node:crypto";
import { normalizeIp } from "./client-ip";

const EXACT_HEX_64_REGEX = /^[0-9a-f]{64}$/;

const KNOWN_PLACEHOLDER_SUBSTRINGS = [
  "replace",
  "placeholder",
  "insecure",
  "example",
  "development-",
];

/**
 * Validates that the provided HMAC secret adheres to the strict 32-byte lowercase hexadecimal contract.
 * Rejects non-hex, uppercase, wrong length, whitespace, empty, or placeholder values fail-closed.
 * Never logs or prints the secret.
 */
export function validateRateLimitSecret(explicitSecret?: string): string {
  const secret = (explicitSecret || process.env.RATE_LIMIT_IDENTIFIER_SECRET || "").trim();

  if (!secret || !EXACT_HEX_64_REGEX.test(secret)) {
    throw new Error(
      "Security Check Failed: RATE_LIMIT_IDENTIFIER_SECRET must be exactly 64 lowercase hexadecimal characters."
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
