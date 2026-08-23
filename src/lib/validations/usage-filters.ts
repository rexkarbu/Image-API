import { UsageFilters, UsageRangePreset } from "@/types/usage";

export const MAX_CUSTOM_RANGE_DAYS = 90;
export const MAX_CUSTOM_RANGE_MS = MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000;
export const ALLOWED_ENDPOINTS = ["/v1/images/transform"] as const;

export interface RangeBoundaries {
  start: Date;
  end: Date;
  bucketInterval: "hour" | "day";
}

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

export type ParseFiltersResult =
  | { success: true; filters: UsageFilters }
  | { success: false; error: string; filters: UsageFilters };

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;
const ISO_UTC_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const STATUS_CODE_REGEX = /^2\d{2}$/;
const ID_FORMAT_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Encodes an opaque, URL-safe pagination cursor for deterministic pagination.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({ c: createdAt.toISOString(), i: id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodes and strictly validates an opaque pagination cursor.
 * Returns null fail-closed if the cursor is malformed, has invalid dates, empty IDs, or unexpected keys.
 */
export function decodeCursor(
  cursorString?: string | null,
  now: Date = new Date()
): DecodedCursor | null {
  if (!cursorString || typeof cursorString !== "string") {
    return null;
  }

  // Exact string without leading/trailing whitespace
  if (cursorString !== cursorString.trim()) {
    return null;
  }

  if (cursorString.length === 0 || cursorString.length > 256) {
    return null;
  }

  if (!BASE64URL_REGEX.test(cursorString)) {
    return null;
  }

  try {
    const raw = Buffer.from(cursorString, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 ||
      typeof parsed.c !== "string" ||
      typeof parsed.i !== "string"
    ) {
      return null;
    }

    if (!ISO_UTC_DATE_REGEX.test(parsed.c)) {
      return null;
    }

    const date = new Date(parsed.c);
    if (isNaN(date.getTime())) {
      return null;
    }

    // Reject future timestamps (allowing 60s clock skew)
    if (date.getTime() > now.getTime() + 60_000) {
      return null;
    }

    const id = parsed.i.trim();
    if (!ID_FORMAT_REGEX.test(id) || parsed.i !== id) {
      return null;
    }

    return {
      createdAt: date,
      id,
    };
  } catch {
    return null;
  }
}

/**
 * Helper to compute the calendar-day exclusive end boundary in UTC (00:00:00.000Z on the next day).
 */
export function computeCalendarDayEndUtc(toDateString: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDateString)) {
    return null;
  }

  const parts = toDateString.split("-").map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts[1] - 1; // 0-indexed
  const day = parts[2];

  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  // Advance by exactly 1 calendar day
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

/**
 * Helper to compute the calendar-day inclusive start boundary in UTC (00:00:00.000Z).
 */
export function computeCalendarDayStartUtc(fromDateString: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDateString)) {
    return null;
  }

  const parts = fromDateString.split("-").map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2];

  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString();
}

/**
 * Parses and strictly normalizes search query parameters into a typed validation result.
 */
export function parseUsageFilters(
  rawParams: Record<string, string | string[] | undefined>,
  now: Date = new Date()
): ParseFiltersResult {
  const getParam = (key: string): { isPresent: boolean; val?: string; isArray: boolean } => {
    const raw = rawParams[key];
    if (raw === undefined) {
      return { isPresent: false, val: undefined, isArray: false };
    }
    if (Array.isArray(raw)) {
      return { isPresent: true, val: raw[0], isArray: true };
    }
    return { isPresent: true, val: raw, isArray: false };
  };

  const rawRange = getParam("range");
  const rawFrom = getParam("from");
  const rawTo = getParam("to");
  const rawApiKeyId = getParam("apiKeyId");
  const rawEndpoint = getParam("endpoint");
  const rawStatusCode = getParam("statusCode");
  const rawCursor = getParam("cursor");

  // Reject duplicate array parameters
  if (
    rawRange.isArray ||
    rawFrom.isArray ||
    rawTo.isArray ||
    rawApiKeyId.isArray ||
    rawEndpoint.isArray ||
    rawStatusCode.isArray ||
    rawCursor.isArray
  ) {
    return {
      success: false,
      error: "Duplicate filter parameters are not allowed.",
      filters: { range: "30d" },
    };
  }

  let range: UsageRangePreset = "30d";
  let from: string | undefined;
  let to: string | undefined;

  const validPresets: UsageRangePreset[] = ["24h", "7d", "30d", "month", "custom"];
  if (rawRange.isPresent) {
    if (!rawRange.val || !validPresets.includes(rawRange.val as UsageRangePreset)) {
      return {
        success: false,
        error: `Invalid date range preset: '${rawRange.val}'.`,
        filters: { range: "30d" },
      };
    }
    range = rawRange.val as UsageRangePreset;
  }

  if (range === "custom") {
    if (!rawFrom.isPresent || !rawTo.isPresent || !rawFrom.val || !rawTo.val) {
      return {
        success: false,
        error: "Custom date range requires both 'from' and 'to' calendar dates.",
        filters: { range: "30d" },
      };
    }

    const fromDate = new Date(rawFrom.val);
    const toDate = new Date(rawTo.val);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return {
        success: false,
        error: "Custom date range contains invalid date values.",
        filters: { range: "30d" },
      };
    }

    if (fromDate.getTime() >= toDate.getTime()) {
      return {
        success: false,
        error: "Custom date range 'from' must be strictly before 'to'.",
        filters: { range: "30d" },
      };
    }

    const diffMs = toDate.getTime() - fromDate.getTime();
    if (diffMs > MAX_CUSTOM_RANGE_MS) {
      return {
        success: false,
        error: `Custom date range exceeds the maximum limit of ${MAX_CUSTOM_RANGE_DAYS} calendar days.`,
        filters: { range: "30d" },
      };
    }

    from = fromDate.toISOString();
    to = toDate.toISOString();
  }

  // Validate statusCode: strict 3-digit 200..299 without leading/trailing whitespace
  let statusCode: number | undefined;
  if (rawStatusCode.isPresent) {
    if (!rawStatusCode.val || !STATUS_CODE_REGEX.test(rawStatusCode.val)) {
      return {
        success: false,
        error: `Invalid status code: '${rawStatusCode.val}'. Must be an integer between 200 and 299.`,
        filters: { range: "30d" },
      };
    }
    statusCode = parseInt(rawStatusCode.val, 10);
  }

  // Validate API key ID
  let apiKeyId: string | undefined;
  if (rawApiKeyId.isPresent) {
    if (!rawApiKeyId.val || !ID_FORMAT_REGEX.test(rawApiKeyId.val)) {
      return {
        success: false,
        error: "Invalid API key ID format.",
        filters: { range: "30d" },
      };
    }
    apiKeyId = rawApiKeyId.val;
  }

  // Validate Endpoint
  let endpoint: string | undefined;
  if (rawEndpoint.isPresent) {
    if (!rawEndpoint.val || !ALLOWED_ENDPOINTS.includes(rawEndpoint.val as any)) {
      return {
        success: false,
        error: `Invalid endpoint filter: '${rawEndpoint.val}'.`,
        filters: { range: "30d" },
      };
    }
    endpoint = rawEndpoint.val;
  }

  // Validate Cursor
  let validCursor: string | undefined;
  if (rawCursor.isPresent) {
    if (!rawCursor.val || !decodeCursor(rawCursor.val, now)) {
      return {
        success: false,
        error: "Invalid pagination cursor.",
        filters: { range: "30d" },
      };
    }
    validCursor = rawCursor.val;
  }

  return {
    success: true,
    filters: {
      range,
      from,
      to,
      apiKeyId,
      endpoint,
      statusCode,
      cursor: validCursor,
    },
  };
}

/**
 * Computes exact UTC start and end boundaries for database query filtering.
 * All ranges use inclusive start and exclusive end: [start, end).
 */
export function computeRangeBoundaries(
  filters: UsageFilters,
  now: Date = new Date()
): RangeBoundaries {
  const currentUtcMs = now.getTime();

  if (filters.range === "24h") {
    const start = new Date(currentUtcMs - 24 * 60 * 60 * 1000);
    return { start, end: now, bucketInterval: "hour" };
  }

  if (filters.range === "7d") {
    const start = new Date(currentUtcMs - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now, bucketInterval: "day" };
  }

  if (filters.range === "30d") {
    const start = new Date(currentUtcMs - 30 * 24 * 60 * 60 * 1000);
    return { start, end: now, bucketInterval: "day" };
  }

  if (filters.range === "month") {
    // Start of current month in UTC (1st day 00:00:00.000 UTC)
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    return { start, end: now, bucketInterval: "day" };
  }

  if (filters.range === "custom" && filters.from && filters.to) {
    const start = new Date(filters.from);
    const end = new Date(filters.to);
    const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const bucketInterval = diffHours <= 48 ? "hour" : "day";
    return { start, end, bucketInterval };
  }

  // Default fallback 30d
  const start = new Date(currentUtcMs - 30 * 24 * 60 * 60 * 1000);
  return { start, end: now, bucketInterval: "day" };
}

/**
 * Computes exact start of current UTC calendar month.
 */
export function getUtcMonthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Generates an ordered array of zero-initialized time buckets spanning [start, end) exclusive.
 */
export function generateTimeBuckets(
  start: Date,
  end: Date,
  interval: "hour" | "day"
): { timestamp: string; label: string; units: number }[] {
  const buckets: { timestamp: string; label: string; units: number }[] = [];
  const current = new Date(start.getTime());

  if (interval === "hour") {
    // Snap to the hour boundary (minutes, seconds, ms)
    current.setUTCMinutes(0, 0, 0);
    while (current.getTime() < end.getTime()) {
      const iso = current.toISOString();
      const hours = current.getUTCHours().toString().padStart(2, "0");
      const label = `${hours}:00`;
      buckets.push({ timestamp: iso, label, units: 0 });
      current.setUTCHours(current.getUTCHours() + 1);
    }
  } else {
    // Snap to the day boundary
    current.setUTCHours(0, 0, 0, 0);
    while (current.getTime() < end.getTime()) {
      const iso = current.toISOString();
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const label = `${monthNames[current.getUTCMonth()]} ${current.getUTCDate()}`;
      buckets.push({ timestamp: iso, label, units: 0 });
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  return buckets;
}
