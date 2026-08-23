import { resolveClientIp } from "@/lib/security/client-ip";
import { checkIpRateLimit, checkApiKeyRateLimit } from "@/lib/ratelimit/limiter";
import { buildRateLimitHeaders } from "@/lib/ratelimit/headers";
import { authenticateApiRequest } from "@/lib/api/auth";
import { validateIdempotencyKey, deriveRequestId } from "@/lib/api/idempotency";
import { parseMultipartRequest } from "@/lib/api/multipart";
import { transformImage } from "@/lib/services/image-transform";
import { isDuplicateRequest, recordUsageEvent } from "@/lib/services/usage-events";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const correlationId = crypto.randomUUID();

  try {
    // 1. Resolve Trusted Client Identity
    const clientIp = resolveClientIp(request, correlationId);

    // 2. Pre-Authentication IP Rate Limiting (120 req / 60s sliding window)
    await checkIpRateLimit(clientIp, correlationId);

    // 3. Authenticate Inbound API Request
    const authIdentity = await authenticateApiRequest(request, correlationId);

    // 4. Authenticated API-Key Rate Limiting (Token Bucket: refill 10/10s, capacity 20)
    const keyRateLimit = await checkApiKeyRateLimit(
      authIdentity.organizationId,
      authIdentity.apiKeyId,
      correlationId
    );

    // 5. Validate Idempotency-Key Header
    const rawIdempotencyKey = validateIdempotencyKey(
      request.headers.get("idempotency-key") || request.headers.get("Idempotency-Key"),
      correlationId
    );

    // 6. Derive Tenant-Namespaced SHA-256 Request ID for Metering
    const meteringRequestId = deriveRequestId(authIdentity.organizationId, rawIdempotencyKey);

    // 7. Pre-check for Sequential Duplicate Request
    const alreadyProcessed = await isDuplicateRequest(meteringRequestId, authIdentity.organizationId);
    if (alreadyProcessed) {
      throw new ApiError(
        409,
        "DUPLICATE_REQUEST",
        "A request with this Idempotency-Key has already been processed.",
        correlationId
      );
    }

    // 8. Streaming Multipart Parsing & Options Validation
    const { fileBuffer, options } = await parseMultipartRequest(request, correlationId);

    // 9. Sandboxed Sharp Image Transformation
    const transformed = await transformImage(fileBuffer, options, correlationId);

    // 10. Check if client disconnected before recording billable usage
    if (request.signal?.aborted) {
      throw new ApiError(
        400,
        "INVALID_MULTIPART",
        "Client connection aborted prior to response completion.",
        correlationId
      );
    }

    // 11. Atomic Usage Event Metering
    await recordUsageEvent(
      {
        requestId: meteringRequestId,
        organizationId: authIdentity.organizationId,
        apiKeyId: authIdentity.apiKeyId,
        endpoint: "/v1/images/transform",
        units: 1,
        statusCode: 200,
      },
      correlationId
    );

    // 12. Return Successful Binary Response with Rate-Limit & Metadata Headers
    const rateLimitHeaders = buildRateLimitHeaders(keyRateLimit);

    return new Response(transformed.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": transformed.contentType,
        "Content-Length": String(transformed.sizeBytes),
        "Content-Disposition": `inline; filename="transformed.${transformed.format}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": correlationId,
        "X-Usage-Units": "1",
        "X-Image-Width": String(transformed.width),
        "X-Image-Height": String(transformed.height),
        ...rateLimitHeaders,
      },
    });
  } catch (err) {
    return createErrorResponse(err, correlationId);
  }
}
