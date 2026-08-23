/**
 * Pure client-safe DTOs and type definitions for Usage Analytics and Dashboard.
 * This file MUST NOT import from @/db, Node.js modules, pg, Drizzle, or server-only packages.
 */

export type UsageRangePreset = "24h" | "7d" | "30d" | "month" | "custom";

export interface UsageFilters {
  range: UsageRangePreset;
  from?: string; // ISO string (UTC)
  to?: string; // ISO string (UTC)
  apiKeyId?: string;
  endpoint?: string;
  statusCode?: number;
  cursor?: string;
}

export interface QuotaSummaryDto {
  configured: boolean;
  allowedMonthlyUnits: number | null;
  usedMonthlyUnits: number;
  remainingMonthlyUnits: number | null;
  percentUsed: number | null;
}

export interface UsageSummaryDto {
  totalUnits: number;
  currentMonthUnits: number;
  activeKeysCount: number;
  latestEventAt: string | null; // ISO string (UTC)
  quota: QuotaSummaryDto;
}

export interface UsageTimeBucketDto {
  timestamp: string; // ISO string (UTC)
  label: string; // e.g. "14:00" or "Aug 23"
  units: number;
}

export interface UsageKeyBreakdownDto {
  apiKeyId: string;
  name: string;
  keyPrefix: string;
  maskedKey: string; // e.g. "img_live_ab12cd34••••••••"
  status: "active" | "revoked";
  units: number;
  percentage: number | null; // null if totalUnits === 0
}

export interface UsageEventDto {
  id: string;
  createdAt: string; // ISO string (UTC)
  apiKeyId: string;
  apiKeyName: string;
  keyPrefix: string;
  maskedKey: string;
  endpoint: string;
  statusCode: number;
  units: number;
}

export interface UsagePageDto {
  events: UsageEventDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FilterOptionDto {
  apiKeyOptions: {
    id: string;
    name: string;
    keyPrefix: string;
    maskedKey: string;
  }[];
  endpointOptions: string[];
  statusCodeOptions: number[];
}

export interface UsageDashboardData {
  summary: UsageSummaryDto;
  timeSeries: UsageTimeBucketDto[];
  keyBreakdown: UsageKeyBreakdownDto[];
  eventsPage: UsagePageDto;
  filterOptions: FilterOptionDto;
  activeFilters: UsageFilters;
  filterError?: string | null;
}
