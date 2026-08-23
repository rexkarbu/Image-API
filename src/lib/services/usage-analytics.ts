import "server-only";

import { db } from "@/db";
import { usageEvents, apiKeys } from "@/db/schema";
import { eq, and, gte, lt, or, sql, desc, count } from "drizzle-orm";
import {
  UsageDashboardData,
  UsageFilters,
  UsageSummaryDto,
  UsageTimeBucketDto,
  UsageKeyBreakdownDto,
  UsageEventDto,
  UsagePageDto,
  FilterOptionDto,
} from "@/types/usage";
import {
  parseUsageFilters,
  computeRangeBoundaries,
  getUtcMonthStart,
  generateTimeBuckets,
  decodeCursor,
  encodeCursor,
} from "@/lib/validations/usage-filters";

export interface GetUsageAnalyticsInput {
  organizationId: string;
  rawFilters?: Record<string, string | string[] | undefined>;
  now?: Date;
}

const PAGE_SIZE = 25;

/**
 * Server-only analytics service retrieving tenant-scoped usage metrics, time-series data,
 * per-key breakdowns, and event streams.
 */
export async function getUsageDashboardData(
  input: GetUsageAnalyticsInput
): Promise<UsageDashboardData> {
  const { organizationId, rawFilters, now = new Date() } = input;

  if (!organizationId || typeof organizationId !== "string" || organizationId.trim().length === 0) {
    throw new Error("Security Violation: organizationId is required for usage analytics queries.");
  }

  const filterValidation = parseUsageFilters(rawFilters || {}, now);
  const activeFilters = filterValidation.filters;
  const filterError = filterValidation.success ? null : filterValidation.error;

  const boundaries = computeRangeBoundaries(activeFilters, now);
  const startOfMonth = getUtcMonthStart(now);

  // Common where conditions for period usage - strictly tenant scoped
  const periodConditions = [
    eq(usageEvents.organizationId, organizationId),
    gte(usageEvents.createdAt, boundaries.start),
    lt(usageEvents.createdAt, boundaries.end),
  ];

  if (activeFilters.apiKeyId) {
    periodConditions.push(eq(usageEvents.apiKeyId, activeFilters.apiKeyId));
  }
  if (activeFilters.endpoint) {
    periodConditions.push(eq(usageEvents.endpoint, activeFilters.endpoint));
  }
  if (activeFilters.statusCode) {
    periodConditions.push(eq(usageEvents.statusCode, activeFilters.statusCode));
  }

  // 1. Fetch Summary, Time-Series, Keys, Events, and Filter Options in parallel
  const [
    selectedPeriodUnitsRes,
    currentMonthUnitsRes,
    activeKeysCountRes,
    latestEventRes,
    timeSeriesRes,
    orgKeysRes,
    keyUsageRes,
    eventsQueryRes,
    distinctEndpointsRes,
    distinctStatusCodesRes,
  ] = await Promise.all([
    // Selected period total units
    filterError
      ? Promise.resolve([{ total: "0" }])
      : db
          .select({ total: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)` })
          .from(usageEvents)
          .where(and(...periodConditions)),

    // Current month total units (strictly org scoped)
    db
      .select({ total: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)` })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          gte(usageEvents.createdAt, startOfMonth),
          lt(usageEvents.createdAt, now)
        )
      ),

    // Active API keys count (strictly org scoped)
    db
      .select({ count: count() })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.organizationId, organizationId),
          eq(apiKeys.status, "active"),
          or(sql`${apiKeys.expiresAt} IS NULL`, gte(apiKeys.expiresAt, now))
        )
      ),

    // Latest activity timestamp in org
    db
      .select({ latest: sql<Date | null>`MAX(${usageEvents.createdAt})` })
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, organizationId)),

    // Time-series aggregation (strictly org scoped)
    filterError
      ? Promise.resolve([])
      : boundaries.bucketInterval === "hour"
        ? db
            .select({
              bucket: sql<string>`to_char(date_trunc('hour', ${usageEvents.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
              units: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)`,
            })
            .from(usageEvents)
            .where(and(...periodConditions))
            .groupBy(sql`date_trunc('hour', ${usageEvents.createdAt} AT TIME ZONE 'UTC')`)
            .orderBy(sql`date_trunc('hour', ${usageEvents.createdAt} AT TIME ZONE 'UTC') ASC`)
        : db
            .select({
              bucket: sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"00:00:00.000"Z"')`,
              units: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)`,
            })
            .from(usageEvents)
            .where(and(...periodConditions))
            .groupBy(sql`date_trunc('day', ${usageEvents.createdAt} AT TIME ZONE 'UTC')`)
            .orderBy(sql`date_trunc('day', ${usageEvents.createdAt} AT TIME ZONE 'UTC') ASC`),

    // Organization's API keys for breakdown & filters (strictly org scoped)
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        status: apiKeys.status,
      })
      .from(apiKeys)
      .where(eq(apiKeys.organizationId, organizationId))
      .orderBy(desc(apiKeys.createdAt)),

    // Usage by API key in selected period (strictly org scoped)
    filterError
      ? Promise.resolve([])
      : db
          .select({
            apiKeyId: usageEvents.apiKeyId,
            units: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)`,
          })
          .from(usageEvents)
          .where(and(...periodConditions))
          .groupBy(usageEvents.apiKeyId),

    // Event stream with stable cursor pagination (strictly org scoped with explicit tenant-scoped join)
    filterError
      ? Promise.resolve([])
      : (() => {
          const eventConditions = [...periodConditions];
          const decodedCursor = decodeCursor(activeFilters.cursor, now);

          if (decodedCursor) {
            eventConditions.push(
              or(
                lt(usageEvents.createdAt, decodedCursor.createdAt),
                and(
                  eq(usageEvents.createdAt, decodedCursor.createdAt),
                  lt(usageEvents.id, decodedCursor.id)
                )
              )!
            );
          }

          return db
            .select({
              id: usageEvents.id,
              createdAt: usageEvents.createdAt,
              apiKeyId: usageEvents.apiKeyId,
              endpoint: usageEvents.endpoint,
              statusCode: usageEvents.statusCode,
              units: usageEvents.units,
              apiKeyName: apiKeys.name,
              keyPrefix: apiKeys.keyPrefix,
            })
            .from(usageEvents)
            .leftJoin(
              apiKeys,
              and(
                eq(usageEvents.apiKeyId, apiKeys.id),
                eq(apiKeys.organizationId, organizationId)
              )
            )
            .where(and(...eventConditions))
            .orderBy(desc(usageEvents.createdAt), desc(usageEvents.id))
            .limit(PAGE_SIZE + 1);
        })(),

    // Distinct endpoints in org for filter dropdown
    db
      .selectDistinct({ endpoint: usageEvents.endpoint })
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, organizationId))
      .limit(10),

    // Distinct status codes in org for filter dropdown
    db
      .selectDistinct({ statusCode: usageEvents.statusCode })
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, organizationId))
      .limit(10),
  ]);

  // 2. Parse Summary Metrics
  const totalUnits = parseInt(selectedPeriodUnitsRes[0]?.total || "0", 10);
  const currentMonthUnits = parseInt(currentMonthUnitsRes[0]?.total || "0", 10);
  const activeKeysCount = activeKeysCountRes[0]?.count || 0;
  const latestEventDate = latestEventRes[0]?.latest;
  const latestEventAt = latestEventDate ? new Date(latestEventDate).toISOString() : null;

  // Truthful Quota: Currently unconfigured (no fabricated denominator)
  const summary: UsageSummaryDto = {
    totalUnits,
    currentMonthUnits,
    activeKeysCount,
    latestEventAt,
    quota: {
      configured: false,
      allowedMonthlyUnits: null,
      usedMonthlyUnits: currentMonthUnits,
      remainingMonthlyUnits: null,
      percentUsed: null,
    },
  };

  // 3. Build Time-Series with Zero-Filled Buckets
  const zeroBuckets = generateTimeBuckets(
    boundaries.start,
    boundaries.end,
    boundaries.bucketInterval
  );
  const bucketMap = new Map<string, number>();
  for (const row of timeSeriesRes) {
    if (row.bucket) {
      const d = new Date(row.bucket);
      if (!isNaN(d.getTime())) {
        bucketMap.set(d.toISOString(), parseInt(row.units || "0", 10));
      }
    }
  }

  const timeSeries: UsageTimeBucketDto[] = zeroBuckets.map((b) => ({
    timestamp: b.timestamp,
    label: b.label,
    units: bucketMap.get(b.timestamp) ?? 0,
  }));

  // 4. Build API Key Usage Breakdown
  const keyUsageMap = new Map<string, number>();
  for (const row of keyUsageRes) {
    keyUsageMap.set(row.apiKeyId, parseInt(row.units || "0", 10));
  }

  const keyBreakdown: UsageKeyBreakdownDto[] = orgKeysRes.map((key) => {
    const units = keyUsageMap.get(key.id) ?? 0;
    const percentage = totalUnits > 0 ? (units / totalUnits) * 100 : null;
    return {
      apiKeyId: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      maskedKey: `${key.keyPrefix}••••••••`,
      status: key.status as "active" | "revoked",
      units,
      percentage,
    };
  });

  // Sort key breakdown: highest usage first, then active keys
  keyBreakdown.sort((a, b) => {
    if (b.units !== a.units) return b.units - a.units;
    return a.name.localeCompare(b.name);
  });

  // 5. Build Event Stream & Cursor Pagination
  const hasMore = eventsQueryRes.length > PAGE_SIZE;
  const pageRows = hasMore ? eventsQueryRes.slice(0, PAGE_SIZE) : eventsQueryRes;

  const events: UsageEventDto[] = pageRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    apiKeyId: row.apiKeyId,
    apiKeyName: row.apiKeyName || "Unknown Key",
    keyPrefix: row.keyPrefix || "img_live_unknown",
    maskedKey: row.keyPrefix ? `${row.keyPrefix}••••••••` : "img_live_••••••••",
    endpoint: row.endpoint,
    statusCode: row.statusCode,
    units: row.units,
  }));

  let nextCursor: string | null = null;
  if (hasMore && pageRows.length > 0) {
    const lastEvent = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor(lastEvent.createdAt, lastEvent.id);
  }

  const eventsPage: UsagePageDto = {
    events,
    nextCursor,
    hasMore,
  };

  // 6. Build Filter Options
  const apiKeyOptions = orgKeysRes.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    maskedKey: `${k.keyPrefix}••••••••`,
  }));

  const endpointOptions = Array.from(
    new Set([
      "/v1/images/transform",
      ...distinctEndpointsRes.map((e) => e.endpoint).filter(Boolean),
    ])
  );

  const statusCodeOptions = Array.from(
    new Set([200, ...distinctStatusCodesRes.map((s) => s.statusCode).filter(Boolean)])
  ).sort();

  const filterOptions: FilterOptionDto = {
    apiKeyOptions,
    endpointOptions,
    statusCodeOptions,
  };

  return {
    summary,
    timeSeries,
    keyBreakdown,
    eventsPage,
    filterOptions,
    activeFilters,
    filterError,
  };
}

/**
 * Lightweight overview query for the /dashboard home page.
 */
export async function getOverviewStats(organizationId: string): Promise<{
  currentMonthUnits: number;
  activeKeysCount: number;
  latestEventAt: string | null;
}> {
  if (!organizationId || typeof organizationId !== "string" || organizationId.trim().length === 0) {
    throw new Error("Security Violation: organizationId is required for overview stats.");
  }

  const now = new Date();
  const startOfMonth = getUtcMonthStart(now);

  const [currentMonthUnitsRes, activeKeysCountRes, latestEventRes] = await Promise.all([
    db
      .select({ total: sql<string>`COALESCE(SUM(${usageEvents.units}), 0)` })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          gte(usageEvents.createdAt, startOfMonth),
          lt(usageEvents.createdAt, now)
        )
      ),

    db
      .select({ count: count() })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.organizationId, organizationId),
          eq(apiKeys.status, "active"),
          or(sql`${apiKeys.expiresAt} IS NULL`, gte(apiKeys.expiresAt, now))
        )
      ),

    db
      .select({ latest: sql<Date | null>`MAX(${usageEvents.createdAt})` })
      .from(usageEvents)
      .where(eq(usageEvents.organizationId, organizationId)),
  ]);

  const currentMonthUnits = parseInt(currentMonthUnitsRes[0]?.total || "0", 10);
  const activeKeysCount = activeKeysCountRes[0]?.count || 0;
  const latestEventDate = latestEventRes[0]?.latest;
  const latestEventAt = latestEventDate ? new Date(latestEventDate).toISOString() : null;

  return {
    currentMonthUnits,
    activeKeysCount,
    latestEventAt,
  };
}
