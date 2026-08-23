import { describe, it, expect } from "vitest";
import {
  parseUsageFilters,
  computeRangeBoundaries,
  encodeCursor,
  decodeCursor,
  generateTimeBuckets,
  getUtcMonthStart,
  MAX_CUSTOM_RANGE_DAYS,
} from "@/lib/validations/usage-filters";
import { UsageKeyBreakdownDto, QuotaSummaryDto } from "@/types/usage";

describe("Usage Filters, Range Math & Cursor Unit Tests", () => {
  const fixedNow = new Date("2026-08-23T16:00:00.000Z");

  it("defaults to 30d preset when no parameters are provided", () => {
    const filters = parseUsageFilters({}, fixedNow);
    expect(filters.range).toBe("30d");
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
    expect(filters.apiKeyId).toBeUndefined();
    expect(filters.endpoint).toBeUndefined();
    expect(filters.statusCode).toBeUndefined();
    expect(filters.cursor).toBeUndefined();
  });

  it("correctly parses all valid range presets (24h, 7d, 30d, month)", () => {
    expect(parseUsageFilters({ range: "24h" }, fixedNow).range).toBe("24h");
    expect(parseUsageFilters({ range: "7d" }, fixedNow).range).toBe("7d");
    expect(parseUsageFilters({ range: "30d" }, fixedNow).range).toBe("30d");
    expect(parseUsageFilters({ range: "month" }, fixedNow).range).toBe("month");
  });

  it("parses valid custom date ranges within 90 days limit", () => {
    const from = "2026-08-01T00:00:00.000Z";
    const to = "2026-08-15T23:59:59.999Z";
    const filters = parseUsageFilters({ range: "custom", from, to }, fixedNow);

    expect(filters.range).toBe("custom");
    expect(filters.from).toBe(from);
    expect(filters.to).toBe(to);
  });

  it("falls back to 30d when custom range has reversed dates (from > to)", () => {
    const from = "2026-08-20T00:00:00.000Z";
    const to = "2026-08-10T00:00:00.000Z";
    const filters = parseUsageFilters({ range: "custom", from, to }, fixedNow);

    expect(filters.range).toBe("30d");
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
  });

  it("falls back to 30d when custom range exceeds 90 days", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-06-01T00:00:00.000Z"; // ~150 days
    const filters = parseUsageFilters({ range: "custom", from, to }, fixedNow);

    expect(filters.range).toBe("30d");
  });

  it("falls back to 30d when custom range dates are invalid strings", () => {
    const filters = parseUsageFilters({ range: "custom", from: "invalid-date", to: "not-a-date" }, fixedNow);
    expect(filters.range).toBe("30d");
  });

  it("parses and validates status codes strictly between 200 and 299", () => {
    expect(parseUsageFilters({ statusCode: "200" }, fixedNow).statusCode).toBe(200);
    expect(parseUsageFilters({ statusCode: "201" }, fixedNow).statusCode).toBe(201);
    expect(parseUsageFilters({ statusCode: "299" }, fixedNow).statusCode).toBe(299);

    // Invalid status codes must be dropped
    expect(parseUsageFilters({ statusCode: "400" }, fixedNow).statusCode).toBeUndefined();
    expect(parseUsageFilters({ statusCode: "500" }, fixedNow).statusCode).toBeUndefined();
    expect(parseUsageFilters({ statusCode: "abc" }, fixedNow).statusCode).toBeUndefined();
  });

  it("computes exact UTC boundaries for 24h range (hourly buckets)", () => {
    const boundaries = computeRangeBoundaries({ range: "24h" }, fixedNow);
    expect(boundaries.end.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect(boundaries.start.toISOString()).toBe("2026-08-22T16:00:00.000Z");
    expect(boundaries.bucketInterval).toBe("hour");
  });

  it("computes exact UTC boundaries for 7d range (daily buckets)", () => {
    const boundaries = computeRangeBoundaries({ range: "7d" }, fixedNow);
    expect(boundaries.end.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect(boundaries.start.toISOString()).toBe("2026-08-16T16:00:00.000Z");
    expect(boundaries.bucketInterval).toBe("day");
  });

  it("computes exact UTC boundaries for 30d range (daily buckets)", () => {
    const boundaries = computeRangeBoundaries({ range: "30d" }, fixedNow);
    expect(boundaries.end.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect(boundaries.start.toISOString()).toBe("2026-07-24T16:00:00.000Z");
    expect(boundaries.bucketInterval).toBe("day");
  });

  it("computes exact UTC start of month for 'month' preset", () => {
    const boundaries = computeRangeBoundaries({ range: "month" }, fixedNow);
    expect(boundaries.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(boundaries.end.toISOString()).toBe("2026-08-23T16:00:00.000Z");
    expect(boundaries.bucketInterval).toBe("day");
  });

  it("selects hourly buckets for custom ranges <= 48 hours and daily for > 48 hours", () => {
    // 24 hour custom range -> hour
    const b1 = computeRangeBoundaries(
      { range: "custom", from: "2026-08-10T00:00:00.000Z", to: "2026-08-11T00:00:00.000Z" },
      fixedNow
    );
    expect(b1.bucketInterval).toBe("hour");

    // 5 day custom range -> day
    const b2 = computeRangeBoundaries(
      { range: "custom", from: "2026-08-10T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" },
      fixedNow
    );
    expect(b2.bucketInterval).toBe("day");
  });

  it("encodes and decodes opaque pagination cursors deterministically", () => {
    const date = new Date("2026-08-23T12:34:56.789Z");
    const eventId = "evt-uuid-12345";

    const cursor = encodeCursor(date, eventId);
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeGreaterThan(0);

    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded?.id).toBe(eventId);
  });

  it("rejects malformed or invalid cursors fail-closed", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ invalid: true })).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ c: "invalid-date", i: "id" })).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ c: "2026-08-23T00:00:00.000Z", i: "" })).toString("base64url"))).toBeNull();
  });

  it("generates zero-filled time buckets spanning the full time range", () => {
    const start = new Date("2026-08-20T00:00:00.000Z");
    const end = new Date("2026-08-23T00:00:00.000Z");

    const buckets = generateTimeBuckets(start, end, "day");
    expect(buckets.length).toBe(4); // Aug 20, 21, 22, 23
    expect(buckets.every((b) => b.units === 0)).toBe(true);
    expect(buckets[0].label).toBe("Aug 20");
    expect(buckets[3].label).toBe("Aug 23");
  });

  it("verifies truthful unconfigured quota DTO structure", () => {
    const quota: QuotaSummaryDto = {
      configured: false,
      allowedMonthlyUnits: null,
      usedMonthlyUnits: 42,
      remainingMonthlyUnits: null,
      percentUsed: null,
    };

    expect(quota.configured).toBe(false);
    expect(quota.allowedMonthlyUnits).toBeNull();
    expect(quota.percentUsed).toBeNull();
  });

  it("handles zero total units in key breakdown without NaN percentage", () => {
    const totalUnits = 0;
    const keyBreakdown: UsageKeyBreakdownDto = {
      apiKeyId: "key-1",
      name: "Production Key",
      keyPrefix: "img_live_ab12cd34",
      maskedKey: "img_live_ab12cd34••••••••",
      status: "active",
      units: 0,
      percentage: totalUnits > 0 ? (0 / totalUnits) * 100 : null,
    };

    expect(keyBreakdown.percentage).toBeNull();
  });
});
