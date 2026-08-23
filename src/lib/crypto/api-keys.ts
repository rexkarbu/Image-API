import crypto from "node:crypto";

export const API_KEY_PREFIX = "img_live_";
export const ALLOWED_SCOPES = ["image:transform"] as const;
export type ApiKeyScope = (typeof ALLOWED_SCOPES)[number];

export type DerivedApiKeyStatus = "active" | "expired" | "revoked";

/**
 * Generates a high-entropy 32-byte cryptographic secret encoded in unpadded Base64URL.
 */
export function generateApiKeySecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Generates a full plaintext API key following the `img_live_<base64url>` contract.
 */
export function generateFullApiKey(): { plaintextKey: string; keyPrefix: string; keyHash: string } {
  const secret = generateApiKeySecret();
  const plaintextKey = `${API_KEY_PREFIX}${secret}`;
  const keyPrefix = `${API_KEY_PREFIX}${secret.slice(0, 8)}`;
  const keyHash = hashApiKey(plaintextKey);

  return {
    plaintextKey,
    keyPrefix,
    keyHash,
  };
}

/**
 * Computes the SHA-256 hash of a full plaintext API key.
 * Returns exactly 64 lowercase hexadecimal characters.
 */
export function hashApiKey(plaintextKey: string): string {
  if (!plaintextKey || !plaintextKey.startsWith(API_KEY_PREFIX)) {
    throw new Error("Invalid API key format for hashing.");
  }
  return crypto.createHash("sha256").update(plaintextKey, "utf8").digest("hex").toLowerCase();
}

/**
 * Validates whether a raw string conforms to the `img_live_<base64url>` shape.
 */
export function isValidApiKeyFormat(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (!key.startsWith(API_KEY_PREFIX)) return false;
  const secretPart = key.slice(API_KEY_PREFIX.length);
  // 32 bytes base64url is 43 characters, matching base64url regex [A-Za-z0-9_-]
  return /^[A-Za-z0-9_-]{43}$/.test(secretPart);
}

/**
 * Derives a human-friendly display prefix for masked representation (e.g. `img_live_ab12cd34...`).
 */
export function deriveApiKeyDisplayPrefix(keyPrefix: string): string {
  if (!keyPrefix.startsWith(API_KEY_PREFIX)) {
    return `${API_KEY_PREFIX}••••••••`;
  }
  return `${keyPrefix}••••••••`;
}

/**
 * Derives the effective status of an API key given its stored status and expiration timestamp.
 */
export function deriveApiKeyStatus(
  storedStatus: "active" | "revoked" | string,
  expiresAt: Date | string | null | undefined,
  now: Date = new Date()
): DerivedApiKeyStatus {
  if (storedStatus === "revoked") {
    return "revoked";
  }

  if (expiresAt) {
    const expiryDate = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
    if (expiryDate.getTime() <= now.getTime()) {
      return "expired";
    }
  }

  return "active";
}

/**
 * Checks whether an organization member role has permission to create, revoke, or rotate API keys.
 * Only 'owner' and 'admin' roles have key management permissions; 'member' has read-only metadata access.
 */
export function canManageApiKeys(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
