import "server-only";

import { verifyApiKey, ApiKeyServiceError, VerifiedApiKeyIdentity } from "@/lib/services/api-keys";
import { ApiError } from "./errors";

const BEARER_PREFIX = "Bearer ";
const GENERIC_UNAUTHORIZED_MESSAGE = "Invalid API credentials.";

/**
 * Server-only request authentication helper for API endpoints.
 * Extracts and verifies the Bearer API key against the database.
 * Employs strictly indistinguishable 401 UNAUTHORIZED responses for all authentication rejections
 * (missing header, wrong scheme, malformed token, unknown key, revoked key, expired key, scope mismatch).
 */
export async function authenticateApiRequest(
  request: Request,
  requestId: string
): Promise<VerifiedApiKeyIdentity> {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    throw new ApiError(401, "UNAUTHORIZED", GENERIC_UNAUTHORIZED_MESSAGE, requestId);
  }

  const rawKey = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!rawKey) {
    throw new ApiError(401, "UNAUTHORIZED", GENERIC_UNAUTHORIZED_MESSAGE, requestId);
  }

  try {
    return await verifyApiKey(rawKey, "image:transform");
  } catch (err) {
    if (err instanceof ApiKeyServiceError && err.code === "UNAUTHORIZED") {
      throw new ApiError(401, "UNAUTHORIZED", GENERIC_UNAUTHORIZED_MESSAGE, requestId);
    }

    // Server-side logging of unexpected failure with only operation and correlation ID
    console.error(`[Auth Error] operation=authenticateApiRequest correlationId=${requestId}`);
    throw new ApiError(
      503,
      "AUTHENTICATION_UNAVAILABLE",
      "Authentication service temporarily unavailable. Please try again later.",
      requestId
    );
  }
}
