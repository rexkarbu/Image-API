import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "INVALID_MULTIPART"
  | "INVALID_OPTIONS"
  | "INVALID_IDEMPOTENCY_KEY"
  | "UNAUTHORIZED"
  | "DUPLICATE_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "UNPROCESSABLE_IMAGE"
  | "RATE_LIMITED"
  | "RATE_LIMIT_UNAVAILABLE"
  | "AUTHENTICATION_UNAVAILABLE"
  | "METERING_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly requestId: string;
  readonly headers?: Record<string, string>;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    requestId: string,
    headers?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
    this.headers = headers;
  }
}

const ALLOWED_ERROR_HEADERS = new Set([
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
]);

const NON_NEGATIVE_INT_REGEX = /^\d+$/;

/**
 * Sanitizes arbitrary error headers to prevent header injection or overriding security headers.
 * Allows only strictly validated rate-limiting headers with non-negative integer values.
 */
export function sanitizeErrorHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers || typeof headers !== "object") return {};
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (ALLOWED_ERROR_HEADERS.has(lowerKey)) {
      if (typeof value === "string" && NON_NEGATIVE_INT_REGEX.test(value.trim())) {
        if (lowerKey === "retry-after") sanitized["Retry-After"] = value.trim();
        else if (lowerKey === "x-ratelimit-limit") sanitized["X-RateLimit-Limit"] = value.trim();
        else if (lowerKey === "x-ratelimit-remaining") sanitized["X-RateLimit-Remaining"] = value.trim();
        else if (lowerKey === "x-ratelimit-reset") sanitized["X-RateLimit-Reset"] = value.trim();
      }
    }
  }

  return sanitized;
}

export function createErrorResponse(
  error: ApiError | Error | unknown,
  requestId: string
): NextResponse {
  if (error instanceof ApiError) {
    const safeRateLimitHeaders = sanitizeErrorHeaders(error.headers);

    const responseHeaders: Record<string, string> = {
      ...safeRateLimitHeaders,
      // Security headers are declared AFTER and cannot be overwritten
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": error.requestId || requestId,
    };

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId: error.requestId || requestId,
        },
      },
      {
        status: error.statusCode,
        headers: responseHeaders,
      }
    );
  }

  // Server-side logging of unhandled exception with sanitized operation metadata only
  console.error(`[Unhandled Route Error] operation=POST /v1/images/transform correlationId=${requestId}`);

  // Generic fallback for unhandled exceptions (never leak internal details or stack traces)
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred while processing the image.",
        requestId,
      },
    },
    {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
      },
    }
  );
}
