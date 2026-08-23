import crypto from "node:crypto";

/**
 * Derives a privacy-preserving, domain-separated HMAC-SHA-256 identifier for Redis rate limiting.
 *
 * Requirements:
 * - Domain separation prevents collisions between IP and API-key identifier spaces.
 * - Outputs lowercase hexadecimal HMAC digests only.
 * - Never stores or transmits plaintext IP addresses, API keys, key hashes, or tenant IDs.
 */

function getSecret(explicitSecret?: string): string {
  const secret = explicitSecret || process.env.RATE_LIMIT_IDENTIFIER_SECRET;
  if (!secret || secret.trim().length < 32) {
    throw new Error(
      "Security Check Failed: RATE_LIMIT_IDENTIFIER_SECRET is missing or insufficiently long (min 32 characters / 64 hex)."
    );
  }
  return secret.trim();
}

/**
 * Derives the HMAC identifier for an IP address.
 * Domain separation prefix: "ip\0"
 */
export function deriveIpIdentifier(clientIp: string, secret?: string): string {
  if (!clientIp || clientIp.trim() === "") {
    throw new Error("Cannot derive rate limit identifier: clientIp is empty.");
  }
  const hmacSecret = getSecret(secret);
  const normalizedIp = clientIp.trim().toLowerCase();
  const payload = `ip\0${normalizedIp}`;

  return crypto.createHmac("sha256", hmacSecret).update(payload).digest("hex");
}

/**
 * Derives the HMAC identifier for an authenticated API key within an organization.
 * Domain separation prefix: "key\0"
 */
export function deriveApiKeyIdentifier(
  organizationId: string,
  apiKeyId: string,
  secret?: string
): string {
  if (!organizationId || organizationId.trim() === "") {
    throw new Error("Cannot derive rate limit identifier: organizationId is empty.");
  }
  if (!apiKeyId || apiKeyId.trim() === "") {
    throw new Error("Cannot derive rate limit identifier: apiKeyId is empty.");
  }
  const hmacSecret = getSecret(secret);
  const payload = `key\0${organizationId.trim()}\0${apiKeyId.trim()}`;

  return crypto.createHmac("sha256", hmacSecret).update(payload).digest("hex");
}
