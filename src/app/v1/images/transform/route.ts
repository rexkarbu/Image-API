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
    // 1. Authenticate Inbound API Request
    const authIdentity = await authenticateApiRequest(request, correlationId);

    // 2. Validate Idempotency-Key Header
    const rawIdempotencyKey = validateIdempotencyKey(
      request.headers.get("idempotency-key") || request.headers.get("Idempotency-Key"),
      correlationId
    );

    // 3. Derive Tenant-Namespaced SHA-256 Request ID for Metering
    const meteringRequestId = deriveRequestId(authIdentity.organizationId, rawIdempotencyKey);

    // 4. Pre-check for Sequential Duplicate Request
    const alreadyProcessed = await isDuplicateRequest(meteringRequestId, authIdentity.organizationId);
    if (alreadyProcessed) {
      throw new ApiError(
        409,
        "DUPLICATE_REQUEST",
        "A request with this Idempotency-Key has already been processed.",
        correlationId
      );
    }

    // 5. Streaming Multipart Parsing & Options Validation
    const { fileBuffer, options } = await parseMultipartRequest(request, correlationId);

    // 6. Sandboxed Sharp Image Transformation
    const transformed = await transformImage(fileBuffer, options, correlationId);

    // 7. Check if client disconnected before recording billable usage
    if (request.signal?.aborted) {
      throw new ApiError(
        400,
        "INVALID_MULTIPART",
        "Client connection aborted prior to response completion.",
        correlationId
      );
    }

    // 8. Atomic Usage Event Metering
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

    // 9. Return Successful Binary Response with Metadata Headers
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
      },
    });
  } catch (err) {
    return createErrorResponse(err, correlationId);
  }
}
