import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tenant context and crypto/service dependencies
vi.mock("@/lib/tenant/context", () => ({
  requireOrganizationContext: vi.fn(),
}));

vi.mock("@/lib/services/api-keys", () => ({
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
  ApiKeyServiceError: class ApiKeyServiceError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "ApiKeyServiceError";
      this.code = code;
    }
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireOrganizationContext } from "@/lib/tenant/context";
import {
  createApiKey,
  revokeApiKey,
  rotateApiKey,
  ApiKeyServiceError,
} from "@/lib/services/api-keys";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  rotateApiKeyAction,
} from "@/actions/api-keys";

describe("API Keys Server Actions Error Boundaries & Role Guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates unauthenticated redirect exceptions thrown by requireOrganizationContext", async () => {
    // Next.js redirect throws a special control flow error
    const redirectError = new Error("NEXT_REDIRECT");
    (redirectError as unknown as { digest: string }).digest = "NEXT_REDIRECT;replace;/sign-in;307;";
    vi.mocked(requireOrganizationContext).mockRejectedValueOnce(redirectError);

    const formData = new FormData();
    formData.set("name", "Test Key");

    await expect(createApiKeyAction(null, formData)).rejects.toThrow("NEXT_REDIRECT");
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("rejects member role before invoking mutation services", async () => {
    vi.mocked(requireOrganizationContext).mockResolvedValueOnce({
      user: { id: "user-1", email: "member@example.com", name: "Member User", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      organization: { id: "org-1", name: "Test Org", createdAt: new Date(), updatedAt: new Date() },
      membership: { organizationId: "org-1", userId: "user-1", role: "member", createdAt: new Date() },
    });

    const formData = new FormData();
    formData.set("name", "Unauthorized Key");

    const result = await createApiKeyAction(null, formData);
    expect(result.success).toBe(false);
    expect(result.code).toBe("FORBIDDEN");
    expect(result.error).toContain("Forbidden");
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("rejects invalid input schema before invoking mutation service", async () => {
    vi.mocked(requireOrganizationContext).mockResolvedValueOnce({
      user: { id: "user-1", email: "owner@example.com", name: "Owner User", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      organization: { id: "org-1", name: "Test Org", createdAt: new Date(), updatedAt: new Date() },
      membership: { organizationId: "org-1", userId: "user-1", role: "owner", createdAt: new Date() },
    });

    const formData = new FormData();
    formData.set("name", "A"); // Too short (min 2 chars)

    const result = await createApiKeyAction(null, formData);
    expect(result.success).toBe(false);
    expect(result.code).toBe("INVALID_INPUT");
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it("returns generic NOT_FOUND_OR_UNAVAILABLE for cross-tenant or nonexistent key revocation", async () => {
    vi.mocked(requireOrganizationContext).mockResolvedValueOnce({
      user: { id: "user-1", email: "owner@example.com", name: "Owner User", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      organization: { id: "org-1", name: "Test Org", createdAt: new Date(), updatedAt: new Date() },
      membership: { organizationId: "org-1", userId: "user-1", role: "owner", createdAt: new Date() },
    });

    vi.mocked(revokeApiKey).mockRejectedValueOnce(
      new ApiKeyServiceError("NOT_FOUND_OR_UNAVAILABLE", "API key not found.")
    );

    const result = await revokeApiKeyAction("nonexistent-or-cross-tenant-key-id");
    expect(result.success).toBe(false);
    expect(result.code).toBe("NOT_FOUND_OR_UNAVAILABLE");
    expect(result.error).toBe("API key not found.");
  });

  it("never returns raw internal database error messages to the client", async () => {
    vi.mocked(requireOrganizationContext).mockResolvedValueOnce({
      user: { id: "user-1", email: "owner@example.com", name: "Owner User", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      organization: { id: "org-1", name: "Test Org", createdAt: new Date(), updatedAt: new Date() },
      membership: { organizationId: "org-1", userId: "user-1", role: "owner", createdAt: new Date() },
    });

    vi.mocked(rotateApiKey).mockRejectedValueOnce(
      new Error("connection to server at 'ep-cool-pooler.neon.tech' (192.0.2.1) failed: FATAL: password authentication failed for user 'neondb_owner'")
    );

    const result = await rotateApiKeyAction("valid-key-id", "immediate");
    expect(result.success).toBe(false);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.error).toBe("An unexpected internal error occurred. Please try again later.");
    expect(result.error).not.toContain("neon.tech");
    expect(result.error).not.toContain("FATAL");
    expect(result.error).not.toContain("password");
  });

  it("returns plaintext key exactly once in the response upon successful creation", async () => {
    vi.mocked(requireOrganizationContext).mockResolvedValueOnce({
      user: { id: "user-1", email: "owner@example.com", name: "Owner User", emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      organization: { id: "org-1", name: "Test Org", createdAt: new Date(), updatedAt: new Date() },
      membership: { organizationId: "org-1", userId: "user-1", role: "owner", createdAt: new Date() },
    });

    const mockCreated = {
      key: {
        id: "key-123",
        organizationId: "org-1",
        name: "Production Server",
        keyPrefix: "img_live_abc12345",
        displayPrefix: "img_live_abc12345••••••••",
        scopes: "image:transform",
        status: "active" as const,
        rawStatus: "active" as const,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      plaintextKey: "img_live_abc12345SECRETKEYPLAINTEXT12345678901234567",
    };

    vi.mocked(createApiKey).mockResolvedValueOnce(mockCreated);

    const formData = new FormData();
    formData.set("name", "Production Server");

    const result = await createApiKeyAction(null, formData);
    expect(result.success).toBe(true);
    expect(result.data?.plaintextKey).toBe(mockCreated.plaintextKey);
    expect(result.data?.key.id).toBe("key-123");
    expect(result.data?.key).not.toHaveProperty("keyHash");
  });
});
