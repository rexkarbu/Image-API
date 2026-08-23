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
    expect(data.filterError).toBeNull();

    expect(data.timeSeries.length).toBeGreaterThan(0);
    expect(data.timeSeries.every((b) => b.units === 0)).toBe(true);
  });

  it("proves true query-free execution across all invalid explicit filter categories", async () => {
    const invalidFilterCases: Record<string, string | string[] | undefined>[] = [
      { range: "invalid_preset" },
      { range: "custom", from: "2026-08-10T00:00:00.000Z" }, // missing to
      { range: "custom", to: "2026-08-10T00:00:00.000Z" }, // missing from
      { range: "custom", from: "2026-08-10T12:00:00.000Z", to: "2026-08-11T00:00:00.000Z" }, // non-midnight
      { range: "custom", from: "2026-02-29T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" }, // impossible leap date in 2026
      { range: "custom", from: "2026-08-20T00:00:00.000Z", to: "2026-08-10T00:00:00.000Z" }, // reversed dates
      { range: "custom", from: "2026-01-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" }, // >90 days
      { statusCode: "500" }, // non-2xx status code
      { statusCode: "200abc" }, // malformed status code
      { endpoint: "/v1/attacker/endpoint" }, // disallowed endpoint
      { apiKeyId: "invalid key with spaces" }, // malformed key ID
      { apiKeyId: "key_live_12345-abc_XYZ" }, // non-UUID key ID
      { apiKeyId: "12345678-1234-4234-8234-123456789ABC" }, // uppercase UUID key ID
      { cursor: "malformed_cursor_base64" }, // malformed cursor
      { range: ["24h", "7d"] as any }, // duplicate array parameters
    ];

    for (const rawFilters of invalidFilterCases) {
      vi.clearAllMocks();

      const data = await getUsageDashboardData({
        organizationId: "org-query-free-test",
        rawFilters,
        now: new Date("2026-08-23T16:00:00.000Z"),
      });

      // Assert zero database queries were dispatched
      expect(db.select).not.toHaveBeenCalled();
      expect(db.selectDistinct).not.toHaveBeenCalled();

      // Assert typed filter error and zeroed metrics
      expect(data.filterError).not.toBeNull();
      expect(data.summary.totalUnits).toBe(0);
      expect(data.summary.currentMonthUnits).toBe(0);
      expect(data.summary.activeKeysCount).toBe(0);
      expect(data.summary.latestEventAt).toBeNull();
      expect(data.timeSeries).toEqual([]);
      expect(data.keyBreakdown).toEqual([]);
      expect(data.eventsPage.events).toEqual([]);
    }
  });

  it("safely eliminates cross-tenant API-key ID leakage on mismatched left join", async () => {
    const mockSelect = vi.mocked(db.select);
    const mockSelectDistinct = vi.mocked(db.selectDistinct);

    // Event row in database has foreign key 'key-org-b-secret-uuid', but join on Org A returns null for apiKeys.id
    const mockEvents = [
      {
        id: "12345678-1234-4234-8234-123456789abc",
        createdAt: new Date("2026-08-23T10:00:00.000Z"),
        endpoint: "/v1/images/transform",
        statusCode: 200,
        units: 1,
        resolvedApiKeyId: null, // join did not match
        apiKeyName: null,
        keyPrefix: null,
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
        where: vi.fn().mockImplementation(() => makeQueryPromise([])),
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
      organizationId: "org-foreign-key-test",
      now: new Date("2026-08-23T16:00:00.000Z"),
    });

    expect(data.eventsPage.events.length).toBe(1);
    const event = data.eventsPage.events[0];

    // Assert apiKeyId is null, and name/prefix are safe placeholders
    expect(event.apiKeyId).toBeNull();
    expect(event.apiKeyName).toBe("Unknown Key");
    expect(event.maskedKey).toBe("img_live_••••••••");

    // Assert serialized JSON contains zero foreign key IDs or secret fields
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("key-org-b-secret-uuid");
    expect(serialized).not.toContain("keyHash");
    expect(serialized).not.toContain("key_hash");
  });
});
