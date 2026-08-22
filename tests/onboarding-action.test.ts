import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCreateOrganization } from "@/app/onboarding/actions";
import * as tenantContext from "@/lib/tenant/context";
import * as tenantOrganizations from "@/lib/tenant/organizations";

vi.mock("@/lib/tenant/context", () => ({
  getServerSessionUser: vi.fn(),
}));

vi.mock("@/lib/tenant/organizations", () => ({
  getUserFirstOrganization: vi.fn(),
  createOrganizationWithMembership: vi.fn(),
}));

describe("Onboarding Server Action (handleCreateOrganization)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return error if user is unauthenticated", async () => {
    vi.mocked(tenantContext.getServerSessionUser).mockResolvedValue(null);

    const formData = new FormData();
    formData.set("name", "Valid Org Name");

    const result = await handleCreateOrganization(null, formData);

    expect(result.error).toContain("Authentication required");
    expect(tenantOrganizations.createOrganizationWithMembership).not.toHaveBeenCalled();
  });

  it("should return error if user already has an organization", async () => {
    vi.mocked(tenantContext.getServerSessionUser).mockResolvedValue({
      id: "user_123",
      name: "Existing User",
      email: "user@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(tenantOrganizations.getUserFirstOrganization).mockResolvedValue({
      organization: {
        id: "org_existing",
        name: "Existing Org",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        organizationId: "org_existing",
        userId: "user_123",
        role: "owner",
        createdAt: new Date(),
      },
    });

    const formData = new FormData();
    formData.set("name", "Another Org");

    const result = await handleCreateOrganization(null, formData);

    expect(result.error).toBe("You already belong to an organization.");
    expect(tenantOrganizations.createOrganizationWithMembership).not.toHaveBeenCalled();
  });

  it("should return field errors if organization name is invalid", async () => {
    vi.mocked(tenantContext.getServerSessionUser).mockResolvedValue({
      id: "user_123",
      name: "Test User",
      email: "user@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(tenantOrganizations.getUserFirstOrganization).mockResolvedValue(null);

    const formData = new FormData();
    formData.set("name", " ");

    const result = await handleCreateOrganization(null, formData);

    expect(result.fieldErrors?.name).toBeDefined();
    expect(tenantOrganizations.createOrganizationWithMembership).not.toHaveBeenCalled();
  });

  it("should atomically create organization and return success when valid", async () => {
    vi.mocked(tenantContext.getServerSessionUser).mockResolvedValue({
      id: "user_123",
      name: "Test User",
      email: "user@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.mocked(tenantOrganizations.getUserFirstOrganization).mockResolvedValue(null);
    vi.mocked(tenantOrganizations.createOrganizationWithMembership).mockResolvedValue({
      organization: {
        id: "org_new",
        name: "Acme Cloud",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        organizationId: "org_new",
        userId: "user_123",
        role: "owner",
        createdAt: new Date(),
      },
    });

    const formData = new FormData();
    formData.set("name", "Acme Cloud");

    const result = await handleCreateOrganization(null, formData);

    expect(result.success).toBe(true);
    expect(tenantOrganizations.createOrganizationWithMembership).toHaveBeenCalledWith(
      "user_123",
      "Acme Cloud"
    );
  });
});
