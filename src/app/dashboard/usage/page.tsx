import { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/tenant/context";
import { getUsageDashboardData } from "@/lib/services/usage-analytics";
import { UsageSummaryCards } from "@/components/usage/usage-summary-cards";
import { UsageFiltersBar } from "@/components/usage/usage-filters-bar";
import { UsageChart } from "@/components/usage/usage-chart";
import { UsageKeyBreakdown } from "@/components/usage/usage-key-breakdown";
import { UsageEventsTable } from "@/components/usage/usage-events-table";
import { AutoRefresh } from "@/components/usage/auto-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Usage & Metering | Image API",
  description: "Monitor tenant transformation volume, API key breakdowns, and real-time usage events.",
};

interface UsagePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function UsageDashboardPage({ searchParams }: UsagePageProps) {
  const { organization } = await requireOrganizationContext();
  const rawParams = await searchParams;

  const data = await getUsageDashboardData({
    organizationId: organization.id,
    rawFilters: rawParams,
  });

  return (
    <div className="space-y-6">
      {/* Header & Auto-Refresh Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-mono text-neutral-500 mb-1">
            <span>{organization.name.toUpperCase()}</span>
            <span>•</span>
            <span>USAGE & METERING</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Usage & Analytics
          </h1>
          <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-1">
            Real-time request metrics, time-series visualization, and per-key consumption.
          </p>
        </div>

        <AutoRefresh />
      </div>

      {/* 1. Summary Metrics Cards */}
      <UsageSummaryCards
        summary={data.summary}
        rangePreset={data.activeFilters.range}
      />

      {/* 2. Interactive Filter Bar */}
      <UsageFiltersBar
        activeFilters={data.activeFilters}
        filterOptions={data.filterOptions}
      />

      {/* 3. Time Series Chart */}
      <UsageChart
        timeSeries={data.timeSeries}
        totalUnits={data.summary.totalUnits}
      />

      {/* 4. API Key Breakdown & Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <UsageKeyBreakdown
            keyBreakdown={data.keyBreakdown}
            totalUnits={data.summary.totalUnits}
          />
        </div>
        <div className="lg:col-span-2">
          <UsageEventsTable
            eventsPage={data.eventsPage}
            activeFilters={data.activeFilters}
          />
        </div>
      </div>
    </div>
  );
}
