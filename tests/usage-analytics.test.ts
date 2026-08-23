import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
  },
}));

import { getUsageDashboardData, getOverviewStats } from "@/lib/services/usage-analytics";
import { db } from "@/db";

describe("Usage Analytics Service Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws a security error if organizationId is empty or whitespace", async () => {
    await expect(getUsageDashboardData({ organizationId: "" })).rejects.toThrow(
      /organizationId is required/
    );
    await expect(getUsageDashboardData({ organizationId: "   " })).rejects.toThrow(
      /organizationId is required/
    );
    await expect(getOverviewStats("")).rejects.toThrow(/organizationId is required/);
  });

  it("safely handles an empty database returning zeroed summary and empty lists", async () => {
    const mockSelect = vi.mocked(db.select);
    const mockSelectDistinct = vi.mocked(db.selectDistinct);

    const makeQueryPromise = (val: any) => {
      const p = Promise.resolve(val);
      return Object.assign(p, {
        orderBy: vi.fn().mockImplementation(() => makeQueryPromise(val)),
        groupBy: vi.fn().mockImplementation(() => makeQueryPromise(val)),
        limit: vi.fn().mockImplementation(() => makeQueryPromise(val)),
        where: vi.fn().mockImplementation(() => makeQueryPromise(val)),
      });
    };

    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeQueryPromise([])),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => makeQueryPromise([])),
        }),
      }),
    } as any));

    mockSelectDistinct.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeQueryPromise([])),
      }),
    } as any));

    const data = await getUsageDashboardData({
      organizationId: "org-empty-test",
      now: new Date("2026-08-23T16:00:00.000Z"),
    });

    expect(data.summary.totalUnits).toBe(0);
    expect(data.summary.currentMonthUnits).toBe(0);
    expect(data.summary.activeKeysCount).toBe(0);
    expect(data.summary.latestEventAt).toBeNull();
    expect(data.summary.quota.configured).toBe(false);
    expect(data.summary.quota.allowedMonthlyUnits).toBeNull();
    expect(data.summary.quota.percentUsed).toBeNull();

    expect(data.keyBreakdown).toEqual([]);
    expect(data.eventsPage.events).toEqual([]);
    expect(data.eventsPage.hasMore).toBe(false);
    expect(data.eventsPage.nextCursor).toBeNull();

    // Verify time series buckets are generated and all have 0 units
    expect(data.timeSeries.length).toBeGreaterThan(0);
    expect(data.timeSeries.every((b) => b.units === 0)).toBe(true);
  });

  it("verifies returned DTOs never contain key_hash or plaintext secret properties", async () => {
    const mockSelect = vi.mocked(db.select);
    const mockSelectDistinct = vi.mocked(db.selectDistinct);

    const mockKeys = [
      {
        id: "key-123",
        name: "Test Key",
        keyPrefix: "img_live_test1234",
        status: "active",
      },
    ];

    const mockEvents = [
      {
        id: "evt-456",
        createdAt: new Date("2026-08-23T10:00:00.000Z"),
        apiKeyId: "key-123",
        endpoint: "/v1/images/transform",
        statusCode: 200,
        units: 1,
        apiKeyName: "Test Key",
        keyPrefix: "img_live_test1234",
      },
    ];

    const makeQueryPromise = (val: any) => {
      const p = Promise.resolve(val);
      return Object.assign(p, {
        orderBy: vi.fn().mockImplementation(() => makeQueryPromise(val)),
        groupBy: vi.fn().mockImplementation(() => makeQueryPromise(val)),
        limit: vi.fn().mockImplementation(() => makeQueryPromise(val)),
        where: vi.fn().mockImplementation(() => makeQueryPromise(val)),
      });
    };

    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeQueryPromise(mockKeys)),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => makeQueryPromise(mockEvents)),
        }),
      }),
    } as any));

    mockSelectDistinct.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeQueryPromise([])),
      }),
    } as any));

    const data = await getUsageDashboardData({
      organizationId: "org-dto-test",
      now: new Date("2026-08-23T16:00:00.000Z"),
    });

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("keyHash");
    expect(serialized).not.toContain("key_hash");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
  });
});
