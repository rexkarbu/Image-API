import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/services/api-keys", () => ({
  verifyApiKey: vi.fn(),
  ApiKeyServiceError: class ApiKeyServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "ApiKeyServiceError";
      this.code = code;
    }
  },
}));

import { authenticateApiRequest } from "@/lib/api/auth";
import { verifyApiKey, ApiKeyServiceError } from "@/lib/services/api-keys";
import { ApiError } from "@/lib/api/errors";

describe("API Request Authentication Helper Unit Tests", () => {
  const reqId = "req-1234-abcd";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 401 UNAUTHORIZED when Authorization header is missing", async () => {
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
    });

    await expect(authenticateApiRequest(req, reqId)).rejects.toThrow(ApiError);
    try {
      await authenticateApiRequest(req, reqId);
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.requestId).toBe(reqId);
    }
  });

  it("throws 401 UNAUTHORIZED when Authorization header does not start with 'Bearer '", async () => {
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });

    try {
      await authenticateApiRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("throws 401 UNAUTHORIZED when Bearer token is empty", async () => {
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { Authorization: "Bearer   " },
    });

    try {
      await authenticateApiRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns verified identity when verifyApiKey succeeds", async () => {
    const mockIdentity = {
      apiKeyId: "key-1",
      organizationId: "org-1",
      scopes: ["image:transform"],
    };
    vi.mocked(verifyApiKey).mockResolvedValueOnce(mockIdentity);

    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { Authorization: "Bearer img_live_validkey12345" },
    });

    const identity = await authenticateApiRequest(req, reqId);
    expect(identity).toEqual(mockIdentity);
    expect(verifyApiKey).toHaveBeenCalledWith("img_live_validkey12345", "image:transform");
  });

  it("maps ApiKeyServiceError UNAUTHORIZED to 401 UNAUTHORIZED", async () => {
    vi.mocked(verifyApiKey).mockRejectedValueOnce(
      new ApiKeyServiceError("UNAUTHORIZED", "Invalid API key.")
    );

    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { Authorization: "Bearer img_live_invalidkey" },
    });

    try {
      await authenticateApiRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("maps unexpected database error to 503 AUTHENTICATION_UNAVAILABLE", async () => {
    vi.mocked(verifyApiKey).mockRejectedValueOnce(new Error("Connection timeout to Neon DB"));

    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
      headers: { Authorization: "Bearer img_live_validkey" },
    });

    try {
      await authenticateApiRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("AUTHENTICATION_UNAVAILABLE");
      expect(err.message).not.toContain("Neon DB");
    }
  });
});
