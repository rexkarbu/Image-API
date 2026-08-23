import { UsageFilters, UsageRangePreset } from "@/types/usage";

export const MAX_CUSTOM_RANGE_DAYS = 90;
export const MAX_CUSTOM_RANGE_MS = MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000;

export interface RangeBoundaries {
  start: Date;
  end: Date;
  bucketInterval: "hour" | "day";
}

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

/**
 * Encodes an opaque, URL-safe pagination cursor for deterministic pagination.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  const payload = JSON.stringify({ c: createdAt.toISOString(), i: id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodes and strictly validates an opaque pagination cursor.
 * Returns null fail-closed if the cursor is malformed, has invalid dates, or empty IDs.
 */
export function decodeCursor(cursorString?: string | null): DecodedCursor | null {
  if (!cursorString || typeof cursorString !== "string") {
    return null;
  }

  try {
    const raw = Buffer.from(cursorString, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.c !== "string" ||
      typeof parsed.i !== "string" ||
      parsed.i.trim().length === 0
    ) {
      return null;
    }

    const date = new Date(parsed.c);
    if (isNaN(date.getTime())) {
      return null;
    }

    return {
      createdAt: date,
      id: parsed.i.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Parses and strictly normalizes search query parameters into valid UsageFilters.
 */
export function parseUsageFilters(
  rawParams: Record<string, string | string[] | undefined>,
  now: Date = new Date()
): UsageFilters {
  const getParam = (key: string): string | undefined => {
    const val = rawParams[key];
    if (Array.isArray(val)) return val[0];
    return typeof val === "string" ? val.trim() : undefined;
  };

  const rawRange = getParam("range");
  const rawFrom = getParam("from");
  const rawTo = getParam("to");
  const rawApiKeyId = getParam("apiKeyId");
  const rawEndpoint = getParam("endpoint");
  const rawStatusCode = getParam("statusCode");
  const rawCursor = getParam("cursor");

  let range: UsageRangePreset = "30d";
  let from: string | undefined;
  let to: string | undefined;

  const validPresets: UsageRangePreset[] = ["24h", "7d", "30d", "month", "custom"];
  if (rawRange && validPresets.includes(rawRange as UsageRangePreset)) {
    range = rawRange as UsageRangePreset;
  }

  if (range === "custom") {
    if (rawFrom && rawTo) {
      const fromDate = new Date(rawFrom);
      const toDate = new Date(rawTo);

      if (
        !isNaN(fromDate.getTime()) &&
        !isNaN(toDate.getTime()) &&
        fromDate.getTime() <= toDate.getTime() &&
        toDate.getTime() - fromDate.getTime() <= MAX_CUSTOM_RANGE_MS
      ) {
        from = fromDate.toISOString();
        to = toDate.toISOString();
      } else {
        // Fallback to default 30d if custom dates are impossible or exceed max range
        range = "30d";
      }
    } else {
      range = "30d";
    }
  }

  // Parse statusCode: integer 200..299
  let statusCode: number | undefined;
  if (rawStatusCode) {
    const parsedCode = parseInt(rawStatusCode, 10);
    if (!isNaN(parsedCode) && parsedCode >= 200 && parsedCode <= 299) {
      statusCode = parsedCode;
    }
  }

  // Validate cursor: fail-closed to undefined if malformed
  let validCursor: string | undefined;
  if (rawCursor && decodeCursor(rawCursor) !== null) {
    validCursor = rawCursor;
  }

  return {
    range,
    from,
    to,
    apiKeyId: rawApiKeyId && rawApiKeyId.length > 0 ? rawApiKeyId : undefined,
    endpoint: rawEndpoint && rawEndpoint.length > 0 ? rawEndpoint : undefined,
    statusCode,
    cursor: validCursor,
  };
}

/**
 * Computes exact UTC start and end boundaries for database query filtering.
 * All ranges use inclusive start and exclusive end.
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
 * Generates an ordered array of zero-initialized time buckets spanning [start, end].
 */
export function generateTimeBuckets(
  start: Date,
  end: Date,
  interval: "hour" | "day"
): { timestamp: string; label: string; units: number }[] {
  const buckets: { timestamp: string; label: string; units: number }[] = [];
  const current = new Date(start.getTime());

  if (interval === "hour") {
    // Snap to the hour boundary
    current.setUTCMinutes(0, 0, 0);
    while (current.getTime() <= end.getTime()) {
      const iso = current.toISOString();
      const hours = current.getUTCHours().toString().padStart(2, "0");
      const label = `${hours}:00`;
      buckets.push({ timestamp: iso, label, units: 0 });
      current.setUTCHours(current.getUTCHours() + 1);
    }
  } else {
    // Snap to the day boundary
    current.setUTCHours(0, 0, 0, 0);
    while (current.getTime() <= end.getTime()) {
      const iso = current.toISOString();
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const label = `${monthNames[current.getUTCMonth()]} ${current.getUTCDate()}`;
      buckets.push({ timestamp: iso, label, units: 0 });
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  return buckets;
}
