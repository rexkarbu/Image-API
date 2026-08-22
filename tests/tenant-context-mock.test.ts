import { describe, it, expect, vi } from "vitest";
import {
  getUserFirstOrganization,
  createOrganizationWithMembership,
  getOrganizationById,
} from "@/lib/tenant/organizations";
import { DbClient } from "@/db";

describe("Tenant Data-Access Helpers with Mocked DB", () => {
  it("getUserFirstOrganization should return membership and organization when found", async () => {
    const mockOrg = {
      id: "org-123",
      name: "Acme Corp",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockMember = {
      organizationId: "org-123",
      userId: "user-456",
      role: "owner",
      createdAt: new Date(),
    };

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { organization: mockOrg, membership: mockMember },
              ]),
            }),
          }),
        }),
      }),
    } as unknown as DbClient;

    const result = await getUserFirstOrganization("user-456", mockDb);

    expect(result).not.toBeNull();
    expect(result?.organization.name).toBe("Acme Corp");
    expect(result?.membership.role).toBe("owner");
  });

  it("getUserFirstOrganization should return null when user has no membership", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    } as unknown as DbClient;

    const result = await getUserFirstOrganization("user-no-org", mockDb);
    expect(result).toBeNull();
  });

  it("getUserFirstOrganization should reject invalid user IDs safely without querying", async () => {
    const mockDb = {
      select: vi.fn(),
    } as unknown as DbClient;

    const resultNull = await getUserFirstOrganization(null as unknown as string, mockDb);
    expect(resultNull).toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("createOrganizationWithMembership should execute inside a single transaction and assign owner role", async () => {
    const mockOrg = {
      id: "generated-org-id",
      name: "New Studio",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockMember = {
      organizationId: "generated-org-id",
      userId: "authenticated-user-1",
      role: "owner",
      createdAt: new Date(),
    };

    const mockTx = {
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          returning: vi.fn().mockImplementation(() => {
            // First call returns org, second returns membership
            if (mockTx.insert.mock.calls.length === 1) {
              return Promise.resolve([mockOrg]);
            }
            return Promise.resolve([mockMember]);
          }),
        })),
      })),
    };

    const mockDb = {
      transaction: vi.fn().mockImplementation(async (callback) => {
        return await callback(mockTx);
      }),
    } as unknown as DbClient;

    const result = await createOrganizationWithMembership(
      "authenticated-user-1",
      "New Studio",
      mockDb
    );

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(result.organization.name).toBe("New Studio");
    expect(result.membership.role).toBe("owner");
    expect(result.membership.userId).toBe("authenticated-user-1");
  });

  it("createOrganizationWithMembership should validate organization name before transaction", async () => {
    const mockDb = {
      transaction: vi.fn(),
    } as unknown as DbClient;

    await expect(
      createOrganizationWithMembership("user-1", " ", mockDb)
    ).rejects.toThrow();

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("getOrganizationById should enforce non-empty organization ID", async () => {
    const mockDb = {
      select: vi.fn(),
    } as unknown as DbClient;

    await expect(getOrganizationById("", mockDb)).rejects.toThrow(
      "TENANT SECURITY INVARIANT VIOLATION"
    );
  });
});
