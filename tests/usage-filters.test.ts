import { describe, it, expect } from "vitest";
import {
  parseUsageFilters,
  computeRangeBoundaries,
  encodeCursor,
  decodeCursor,
  generateTimeBuckets,
  computeCalendarDayStartUtc,
  computeCalendarDayEndUtc,
  MAX_CUSTOM_RANGE_DAYS,
} from "@/lib/validations/usage-filters";
import { UsageKeyBreakdownDto, QuotaSummaryDto } from "@/types/usage";

describe("Usage Filters, Range Math & Cursor Unit Tests", () => {
  const fixedNow = new Date("2026-08-23T16:00:00.000Z");

  it("defaults cleanly to 30d preset when no parameters are provided", () => {
    const res = parseUsageFilters({}, fixedNow);
    expect(res.success).toBe(true);
    expect(res.filters.range).toBe("30d");
    expect(res.filters.from).toBeUndefined();
    expect(res.filters.to).toBeUndefined();
    expect(res.filters.apiKeyId).toBeUndefined();
    expect(res.filters.endpoint).toBeUndefined();
    expect(res.filters.statusCode).toBeUndefined();
    expect(res.filters.cursor).toBeUndefined();
  });

  it("correctly parses all valid range presets (24h, 7d, 30d, month)", () => {
    expect(parseUsageFilters({ range: "24h" }, fixedNow).filters.range).toBe("24h");
    expect(parseUsageFilters({ range: "7d" }, fixedNow).filters.range).toBe("7d");
    expect(parseUsageFilters({ range: "30d" }, fixedNow).filters.range).toBe("30d");
    expect(parseUsageFilters({ range: "month" }, fixedNow).filters.range).toBe("month");
  });

  it("rejects invalid date range preset with typed error", () => {
    const res = parseUsageFilters({ range: "invalid_preset" }, fixedNow);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain("Invalid date range preset");
    }
  });

  it("parses valid custom date ranges within 90 days limit", () => {
    const from = "2026-08-01T00:00:00.000Z";
    const to = "2026-08-16T00:00:00.000Z"; // 15 full calendar days
    const res = parseUsageFilters({ range: "custom", from, to }, fixedNow);

    expect(res.success).toBe(true);
    expect(res.filters.range).toBe("custom");
    expect(res.filters.from).toBe(from);
    expect(res.filters.to).toBe(to);
  });

  it("rejects custom range when from or to date is missing", () => {
    const res1 = parseUsageFilters({ range: "custom", from: "2026-08-01T00:00:00.000Z" }, fixedNow);
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.error).toContain("requires both 'from' and 'to'");
    }

    const res2 = parseUsageFilters({ range: "custom", to: "2026-08-01T00:00:00.000Z" }, fixedNow);
    expect(res2.success).toBe(false);
  });

  it("rejects custom range when dates are reversed (from >= to)", () => {
    const from = "2026-08-20T00:00:00.000Z";
    const to = "2026-08-10T00:00:00.000Z";
    const res = parseUsageFilters({ range: "custom", from, to }, fixedNow);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain("must be strictly before");
    }
  });

  it("rejects custom range when dates exceed 90 calendar days", () => {
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-06-01T00:00:00.000Z"; // ~150 days
    const res = parseUsageFilters({ range: "custom", from, to }, fixedNow);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain("exceeds the maximum limit of 90 calendar days");
    }
  });

  it("accepts custom range of exactly 90 calendar days", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
    const res = parseUsageFilters({ range: "custom", from: start.toISOString(), to: end.toISOString() }, fixedNow);

    expect(res.success).toBe(true);
  });

  it("computes calendar-day UTC start and exclusive end boundaries", () => {
    // 1-day selection: Aug 10 to Aug 10
    const from1 = computeCalendarDayStartUtc("2026-08-10");
    const to1 = computeCalendarDayEndUtc("2026-08-10");
    expect(from1).toBe("2026-08-10T00:00:00.000Z");
    expect(to1).toBe("2026-08-11T00:00:00.000Z");

    // 2-day selection: Aug 10 to Aug 11
    const to2 = computeCalendarDayEndUtc("2026-08-11");
    expect(to2).toBe("2026-08-12T00:00:00.000Z");

    // Leap-day & month boundary: Feb 28, 2024 to Feb 29, 2024
    const fromLeap = computeCalendarDayStartUtc("2024-02-28");
    const toLeap = computeCalendarDayEndUtc("2024-02-29");
    expect(fromLeap).toBe("2024-02-28T00:00:00.000Z");
    expect(toLeap).toBe("2024-03-01T00:00:00.000Z");

    // Invalid calendar date rejected
    expect(computeCalendarDayEndUtc("2026-02-30")).toBeNull();
    expect(computeCalendarDayStartUtc("invalid")).toBeNull();
  });

  it("strictly validates status codes: accepts 200..299, rejects others and malformed strings", () => {
    expect(parseUsageFilters({ statusCode: "200" }, fixedNow).filters.statusCode).toBe(200);
    expect(parseUsageFilters({ statusCode: "201" }, fixedNow).filters.statusCode).toBe(201);
    expect(parseUsageFilters({ statusCode: "299" }, fixedNow).filters.statusCode).toBe(299);

    // Reject non-3-digit or malformed formats with typed error
    const badCodes = ["200abc", "200.5", "+200", " 200 ", "0200", "199", "300", "400", "500", "abc"];
    for (const bad of badCodes) {
      const res = parseUsageFilters({ statusCode: bad }, fixedNow);
      expect(res.success).toBe(false);
    }
  });

  it("strictly validates API key ID format", () => {
    const validId = "key_live_12345-abc_XYZ";
    expect(parseUsageFilters({ apiKeyId: validId }, fixedNow).filters.apiKeyId).toBe(validId);

    // Malformed ID with invalid characters or too long
    const resBad = parseUsageFilters({ apiKeyId: "key with spaces" }, fixedNow);
    expect(resBad.success).toBe(false);

    const resTooLong = parseUsageFilters({ apiKeyId: "a".repeat(65) }, fixedNow);
    expect(resTooLong.success).toBe(false);
  });

  it("strictly validates endpoint against whitelist", () => {
    expect(parseUsageFilters({ endpoint: "/v1/images/transform" }, fixedNow).filters.endpoint).toBe(
      "/v1/images/transform"
    );

    const resBad = parseUsageFilters({ endpoint: "/v1/malicious/endpoint" }, fixedNow);
    expect(resBad.success).toBe(false);
  });

  it("rejects duplicate array parameters fail-closed", () => {
    const res = parseUsageFilters({ range: ["24h", "7d"] } as any, fixedNow);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain("Duplicate filter parameters");
    }
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

  it("generates zero-filled time buckets using exclusive end boundary [start, end)", () => {
    // August 20 00:00 to August 23 00:00 must produce exactly 3 daily buckets: Aug 20, 21, 22
    const start = new Date("2026-08-20T00:00:00.000Z");
    const end = new Date("2026-08-23T00:00:00.000Z");

    const buckets = generateTimeBuckets(start, end, "day");
    expect(buckets.length).toBe(3); // Aug 20, 21, 22
    expect(buckets.every((b) => b.units === 0)).toBe(true);
    expect(buckets[0].label).toBe("Aug 20");
    expect(buckets[1].label).toBe("Aug 21");
    expect(buckets[2].label).toBe("Aug 22");

    // Hourly buckets: 14:00 to 17:00 must produce 14:00, 15:00, 16:00 (3 buckets)
    const hourStart = new Date("2026-08-23T14:00:00.000Z");
    const hourEnd = new Date("2026-08-23T17:00:00.000Z");
    const hourBuckets = generateTimeBuckets(hourStart, hourEnd, "hour");
    expect(hourBuckets.length).toBe(3);
    expect(hourBuckets[0].label).toBe("14:00");
    expect(hourBuckets[1].label).toBe("15:00");
    expect(hourBuckets[2].label).toBe("16:00");
  });

  it("encodes and decodes opaque pagination cursors deterministically", () => {
    const date = new Date("2026-08-23T12:34:56.789Z");
    const eventId = "evt-uuid-12345";

    const cursor = encodeCursor(date, eventId);
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeGreaterThan(0);

    const decoded = decodeCursor(cursor, fixedNow);
    expect(decoded).not.toBeNull();
    expect(decoded?.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded?.id).toBe(eventId);
  });

  it("hardened cursor validation rejects all malformed, future, or oversized cursors fail-closed", () => {
    expect(decodeCursor(undefined, fixedNow)).toBeNull();
    expect(decodeCursor(null, fixedNow)).toBeNull();
    expect(decodeCursor("", fixedNow)).toBeNull();
    expect(decodeCursor("not-base64-json", fixedNow)).toBeNull();
    expect(decodeCursor("a".repeat(257), fixedNow)).toBeNull(); // >256 chars

    // Non-canonical shapes / extra fields
    const extraField = Buffer.from(JSON.stringify({ c: "2026-08-23T00:00:00.000Z", i: "id", extra: "val" })).toString("base64url");
    expect(decodeCursor(extraField, fixedNow)).toBeNull();

    // Invalid date string
    const invalidDate = Buffer.from(JSON.stringify({ c: "not-a-date", i: "id" })).toString("base64url");
    expect(decodeCursor(invalidDate, fixedNow)).toBeNull();

    // Future timestamp (>60s in future)
    const futureDate = new Date(fixedNow.getTime() + 120_000).toISOString();
    const futureCursor = Buffer.from(JSON.stringify({ c: futureDate, i: "id" })).toString("base64url");
    expect(decodeCursor(futureCursor, fixedNow)).toBeNull();

    // Empty ID
    const emptyId = Buffer.from(JSON.stringify({ c: "2026-08-23T00:00:00.000Z", i: "" })).toString("base64url");
    expect(decodeCursor(emptyId, fixedNow)).toBeNull();

    // Malformed ID with disallowed characters
    const badId = Buffer.from(JSON.stringify({ c: "2026-08-23T00:00:00.000Z", i: "id with space" })).toString("base64url");
    expect(decodeCursor(badId, fixedNow)).toBeNull();
  });
});
