import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api/auth", () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  validateIdempotencyKey: vi.fn(),
  deriveRequestId: vi.fn(),
}));

vi.mock("@/lib/api/multipart", () => ({
  parseMultipartRequest: vi.fn(),
}));

vi.mock("@/lib/services/image-transform", () => ({
  transformImage: vi.fn(),
}));

vi.mock("@/lib/services/usage-events", () => ({
  isDuplicateRequest: vi.fn(),
  recordUsageEvent: vi.fn(),
}));

import { POST } from "@/app/v1/images/transform/route";
import { authenticateApiRequest } from "@/lib/api/auth";
import { validateIdempotencyKey, deriveRequestId } from "@/lib/api/idempotency";
import { parseMultipartRequest } from "@/lib/api/multipart";
import { transformImage } from "@/lib/services/image-transform";
import { isDuplicateRequest, recordUsageEvent } from "@/lib/services/usage-events";
import { ApiError } from "@/lib/api/errors";

describe("POST /v1/images/transform Route Orchestration & Error Boundary Unit Tests", () => {
  const mockIdentity = {
    apiKeyId: "key-test-123",
    organizationId: "org-test-456",
    scopes: ["image:transform"],
  };

  const mockOptions = {
    width: 100,
    height: 100,
    format: "webp" as const,
    quality: 80,
    fit: "inside" as const,
    withoutEnlargement: true,
  };

  const mockTransformResult = {
    buffer: new Uint8Array([1, 2, 3]),
    contentType: "image/webp",
    format: "webp" as const,
    width: 100,
    height: 100,
    sizeBytes: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(authenticateApiRequest).mockResolvedValue(mockIdentity);
    vi.mocked(validateIdempotencyKey).mockReturnValue("valid-idempotency-key-123456789");
    vi.mocked(deriveRequestId).mockReturnValue("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    vi.mocked(isDuplicateRequest).mockResolvedValue(false);
    vi.mocked(parseMultipartRequest).mockResolvedValue({
      fileBuffer: Buffer.from("dummy-png"),
      options: mockOptions,
    });
    vi.mocked(transformImage).mockResolvedValue(mockTransformResult);
    vi.mocked(recordUsageEvent).mockResolvedValue(undefined as any);
  });

  function createRequest(options?: { headers?: Record<string, string>; signal?: AbortSignal }): Request {
    return new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: {
        Authorization: "Bearer img_live_testkey123",
        "Idempotency-Key": "valid-idempotency-key-123456789",
        "Content-Type": "multipart/form-data; boundary=---boundary",
        ...options?.headers,
      },
      signal: options?.signal,
    });
  }

  /**
   * Shared assertion helper to verify security headers and correlation ID matching across ALL route responses.
   */
  async function assertSecurityHeadersAndEnvelope(
    res: Response,
    expectedStatus: number,
    isJsonError = false
  ): Promise<any> {
    expect(res.status).toBe(expectedStatus);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const requestIdHeader = res.headers.get("x-request-id");
    expect(requestIdHeader).toBeDefined();
    expect(typeof requestIdHeader).toBe("string");
    expect(requestIdHeader!.length).toBeGreaterThan(0);

    if (isJsonError) {
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBeDefined();
      expect(json.error.message).toBeDefined();
      expect(json.error.requestId).toBeDefined();
      // error.requestId MUST equal X-Request-ID header
      expect(json.error.requestId).toBe(requestIdHeader);
      return json;
    }
    return null;
  }

  it("successfully orchestrates 200 transformation with all security headers and records metering", async () => {
    const req = createRequest();
    const res = await POST(req);

    await assertSecurityHeadersAndEnvelope(res, 200, false);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-usage-units")).toBe("1");
    expect(res.headers.get("x-image-width")).toBe("100");
    expect(res.headers.get("x-image-height")).toBe("100");

    expect(authenticateApiRequest).toHaveBeenCalledTimes(1);
    expect(isDuplicateRequest).toHaveBeenCalledTimes(1);
    expect(parseMultipartRequest).toHaveBeenCalledTimes(1);
    expect(transformImage).toHaveBeenCalledTimes(1);
    expect(recordUsageEvent).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with security headers when authentication service is unavailable and prevents downstream execution", async () => {
    vi.mocked(authenticateApiRequest).mockRejectedValueOnce(
      new ApiError(
        503,
        "AUTHENTICATION_UNAVAILABLE",
        "Authentication service temporarily unavailable. Please try again later.",
        "req-auth-fail"
      )
    );

    const req = createRequest();
    const res = await POST(req);

    const json = await assertSecurityHeadersAndEnvelope(res, 503, true);
    expect(json.error.code).toBe("AUTHENTICATION_UNAVAILABLE");
    expect(json.error.message).toBe("Authentication service temporarily unavailable. Please try again later.");

    // Downstream services must not be invoked
    expect(parseMultipartRequest).not.toHaveBeenCalled();
    expect(transformImage).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("returns 500 INTERNAL_ERROR with security headers on unhandled exceptions and prevents metering without exposing internal error text", async () => {
    vi.mocked(parseMultipartRequest).mockRejectedValueOnce(
      new Error("CRITICAL_INTERNAL_FATAL_NODE_POSTGRES_POOL_ERROR_LEAK")
    );

    const req = createRequest();
    const res = await POST(req);

    const json = await assertSecurityHeadersAndEnvelope(res, 500, true);
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(json.error.message).toBe("An internal server error occurred while processing the image.");
    expect(json.error.message).not.toContain("CRITICAL");
    expect(json.error.message).not.toContain("POSTGRES");
    expect(json.error.message).not.toContain("POOL");

    expect(transformImage).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("returns 409 DUPLICATE_REQUEST with security headers on duplicate idempotency key and prevents image transform and usage recording", async () => {
    vi.mocked(isDuplicateRequest).mockResolvedValueOnce(true);

    const req = createRequest();
    const res = await POST(req);

    const json = await assertSecurityHeadersAndEnvelope(res, 409, true);
    expect(json.error.code).toBe("DUPLICATE_REQUEST");
    expect(json.error.message).toBe("A request with this Idempotency-Key has already been processed.");

    expect(parseMultipartRequest).not.toHaveBeenCalled();
    expect(transformImage).not.toHaveBeenCalled();
    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("returns 422 UNPROCESSABLE_IMAGE with security headers and prevents recordUsageEvent when image transformation fails", async () => {
    vi.mocked(transformImage).mockRejectedValueOnce(
      new ApiError(
        422,
        "UNPROCESSABLE_IMAGE",
        "The uploaded file could not be parsed as a valid image.",
        "req-transform-fail"
      )
    );

    const req = createRequest();
    const res = await POST(req);

    const json = await assertSecurityHeadersAndEnvelope(res, 422, true);
    expect(json.error.code).toBe("UNPROCESSABLE_IMAGE");
    expect(json.error.message).toBe("The uploaded file could not be parsed as a valid image.");

    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_MULTIPART with security headers and prevents recordUsageEvent when request is aborted prior to metering", async () => {
    const controller = new AbortController();
    controller.abort();

    const req = createRequest({ signal: controller.signal });
    const res = await POST(req);

    const json = await assertSecurityHeadersAndEnvelope(res, 400, true);
    expect(json.error.code).toBe("INVALID_MULTIPART");
    expect(json.error.message).toBe("Client connection aborted prior to response completion.");

    expect(recordUsageEvent).not.toHaveBeenCalled();
  });

  it("returns 503 METERING_UNAVAILABLE with security headers when usage event insertion fails without exposing raw DB error details", async () => {
    vi.mocked(recordUsageEvent).mockRejectedValueOnce(
      new ApiError(
        503,
        "METERING_UNAVAILABLE",
        "Usage metering service temporarily unavailable. Request was processed but could not be finalized.",
        "req-meter-fail"
      )
    );

    const req = createRequest();
    const res = await POST(req);

    const json = await assertSecurityHeadersAndEnvelope(res, 503, true);
    expect(json.error.code).toBe("METERING_UNAVAILABLE");
    expect(json.error.message).toBe(
      "Usage metering service temporarily unavailable. Request was processed but could not be finalized."
    );
    expect(json.error.message).not.toContain("PostgreSQL");
  });
});
