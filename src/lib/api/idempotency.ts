import crypto from "node:crypto";
import { ApiError } from "./errors";

// Visible ASCII characters range: ! (33) to ~ (126), length between 16 and 128 characters
const IDEMPOTENCY_KEY_REGEX = /^[!-~]{16,128}$/;

/**
 * Validates the Idempotency-Key header value.
 * Throws 400 INVALID_IDEMPOTENCY_KEY if missing, malformed, or outside length limits.
 */
export function validateIdempotencyKey(
  rawHeader: string | null | undefined,
  requestId: string
): string {
  if (!rawHeader || typeof rawHeader !== "string") {
    throw new ApiError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Missing required Idempotency-Key header.",
      requestId
    );
  }

  const trimmed = rawHeader.trim();
  if (trimmed !== rawHeader || !IDEMPOTENCY_KEY_REGEX.test(rawHeader)) {
    throw new ApiError(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key must consist of 16 to 128 printable ASCII characters without control characters or whitespace.",
      requestId
    );
  }

  return rawHeader;
}

/**
 * Derives the immutable, tenant-namespaced 64-character SHA-256 request_id for usage recording.
 * Ensures the raw user idempotency key is never persisted or logged.
 */
export function deriveRequestId(organizationId: string, rawIdempotencyKey: string): string {
  return crypto
    .createHash("sha256")
    .update(`${organizationId}\0${rawIdempotencyKey}`, "utf8")
    .digest("hex")
    .toLowerCase();
}
