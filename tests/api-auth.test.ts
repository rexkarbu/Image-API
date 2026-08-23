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

describe("API Request Authentication Helper Unit Tests (Indistinguishable 401s)", () => {
  const reqId = "req-1234-abcd";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws uniform 401 UNAUTHORIZED when Authorization header is missing", async () => {
    const req = new Request("http://localhost:3000/v1/images/transform", {
      method: "POST",
    });

    try {
      await authenticateApiRequest(req, reqId);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.message).toBe("Invalid API credentials.");
      expect(err.requestId).toBe(reqId);
    }
  });

  it("throws uniform 401 UNAUTHORIZED when Authorization header scheme is not Bearer", async () => {
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
      expect(err.message).toBe("Invalid API credentials.");
    }
  });

  it("throws uniform 401 UNAUTHORIZED when Bearer token is empty", async () => {
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
      expect(err.message).toBe("Invalid API credentials.");
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

  it("proves all authentication rejection bodies are completely indistinguishable (excluding requestId)", async () => {
    const rejectionScenarios: { name: string; request: Request; setupMock?: () => void }[] = [
      {
        name: "Missing header",
        request: new Request("http://localhost:3000/v1/images/transform", { method: "POST" }),
      },
      {
        name: "Wrong scheme",
        request: new Request("http://localhost:3000/v1/images/transform", {
          method: "POST",
          headers: { Authorization: "Token img_live_12345" },
        }),
      },
      {
        name: "Empty token",
        request: new Request("http://localhost:3000/v1/images/transform", {
          method: "POST",
          headers: { Authorization: "Bearer " },
        }),
      },
      {
        name: "Unknown key",
        request: new Request("http://localhost:3000/v1/images/transform", {
          method: "POST",
          headers: { Authorization: "Bearer img_live_unknownkey123" },
        }),
        setupMock: () =>
          vi.mocked(verifyApiKey).mockRejectedValueOnce(
            new ApiKeyServiceError("UNAUTHORIZED", "API key not found.")
          ),
      },
      {
        name: "Revoked key",
        request: new Request("http://localhost:3000/v1/images/transform", {
          method: "POST",
          headers: { Authorization: "Bearer img_live_revokedkey123" },
        }),
        setupMock: () =>
          vi.mocked(verifyApiKey).mockRejectedValueOnce(
            new ApiKeyServiceError("UNAUTHORIZED", "API key has been revoked.")
          ),
      },
      {
        name: "Expired key",
        request: new Request("http://localhost:3000/v1/images/transform", {
          method: "POST",
          headers: { Authorization: "Bearer img_live_expiredkey123" },
        }),
        setupMock: () =>
          vi.mocked(verifyApiKey).mockRejectedValueOnce(
            new ApiKeyServiceError("UNAUTHORIZED", "API key has expired.")
          ),
      },
      {
        name: "Scope mismatch",
        request: new Request("http://localhost:3000/v1/images/transform", {
          method: "POST",
          headers: { Authorization: "Bearer img_live_noscopekey123" },
        }),
        setupMock: () =>
          vi.mocked(verifyApiKey).mockRejectedValueOnce(
            new ApiKeyServiceError("UNAUTHORIZED", "API key missing required scope: image:transform")
          ),
      },
    ];

    const results: { statusCode: number; code: string; message: string }[] = [];

    for (const scenario of rejectionScenarios) {
      if (scenario.setupMock) scenario.setupMock();
      try {
        await authenticateApiRequest(scenario.request, reqId);
        expect.fail(`Scenario '${scenario.name}' should have rejected`);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        results.push({
          statusCode: err.statusCode,
          code: err.code,
          message: err.message,
        });
      }
    }

    expect(results.length).toBe(rejectionScenarios.length);
    const expected = {
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Invalid API credentials.",
    };

    for (const res of results) {
      expect(res).toEqual(expected);
    }
  });

  it("maps unexpected database error to 503 AUTHENTICATION_UNAVAILABLE without leaking connection details", async () => {
    vi.mocked(verifyApiKey).mockRejectedValueOnce(new Error("Neon connection timeout / password error"));

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
      expect(err.message).toBe("Authentication service temporarily unavailable. Please try again later.");
      expect(err.message).not.toContain("Neon");
      expect(err.message).not.toContain("timeout");
    }
  });
});
