import "server-only";

import { verifyApiKey, ApiKeyServiceError, VerifiedApiKeyIdentity } from "@/lib/services/api-keys";
import { ApiError } from "./errors";

const BEARER_PREFIX = "Bearer ";

/**
 * Server-only request authentication helper for API endpoints.
 * Extracts and verifies the Bearer API key against the database.
 * Employs indistinguishable 401 UNAUTHORIZED responses for all authentication rejections.
 */
export async function authenticateApiRequest(
  request: Request,
  requestId: string
): Promise<VerifiedApiKeyIdentity> {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith(BEARER_PREFIX)) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Missing or invalid Authorization header. Expected 'Bearer img_live_...'.",
      requestId
    );
  }

  const rawKey = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!rawKey) {
    throw new ApiError(
      401,
      "UNAUTHORIZED",
      "Missing or invalid API key.",
      requestId
    );
  }

  try {
    return await verifyApiKey(rawKey, "image:transform");
  } catch (err) {
    if (err instanceof ApiKeyServiceError && err.code === "UNAUTHORIZED") {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "Invalid, revoked, or expired API key.",
        requestId
      );
    }

    // Server-side logging of unexpected failure without leaking key
    console.error(`[Auth Service Unavailable] requestId=${requestId}`);
    throw new ApiError(
      503,
      "AUTHENTICATION_UNAVAILABLE",
      "Authentication service temporarily unavailable. Please try again later.",
      requestId
    );
  }
}
