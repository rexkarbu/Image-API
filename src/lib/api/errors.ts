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
  | "AUTHENTICATION_UNAVAILABLE"
  | "METERING_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly requestId: string;

  constructor(statusCode: number, code: ApiErrorCode, message: string, requestId: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createErrorResponse(
  error: ApiError | Error | unknown,
  requestId: string
): NextResponse {
  if (error instanceof ApiError) {
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
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Request-ID": error.requestId || requestId,
        },
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
