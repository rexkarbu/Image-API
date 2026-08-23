/**
 * Pure browser-safe calendar and date utility functions for Usage Analytics.
 * This module has ZERO Node.js, Buffer, ORM, or database dependencies.
 */

export const MAX_CUSTOM_RANGE_DAYS = 90;
export const MAX_CUSTOM_RANGE_MS = MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000;
export const ALLOWED_ENDPOINTS = ["/v1/images/transform"] as const;

/**
 * Checks if a year, month (0-indexed), and day form a valid Gregorian calendar date.
 * Strictly rejects invalid days such as Feb 29 in non-leap years or April 31.
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100) return false;
  if (month < 0 || month > 11) return false;
  if (day < 1 || day > 31) return false;

  const d = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month &&
    d.getUTCDate() === day
  );
}

/**
 * Helper to compute the calendar-day inclusive start boundary in UTC (00:00:00.000Z).
 * Input format: "YYYY-MM-DD"
 */
export function computeCalendarDayStartUtc(fromDateString: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDateString)) {
    return null;
  }

  const parts = fromDateString.split("-").map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2];

  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  return date.toISOString();
}

/**
 * Helper to compute the calendar-day exclusive end boundary in UTC (00:00:00.000Z on the next day).
 * Input format: "YYYY-MM-DD"
 */
export function computeCalendarDayEndUtc(toDateString: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDateString)) {
    return null;
  }

  const parts = toDateString.split("-").map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2];

  if (!isValidCalendarDate(year, month, day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  // Advance by exactly 1 calendar day in UTC
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
