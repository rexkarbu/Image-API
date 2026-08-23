import { UsageSummaryDto, UsageRangePreset } from "@/types/usage";
import { Activity, Key, Layers, ShieldCheck } from "lucide-react";

interface UsageSummaryCardsProps {
  summary: UsageSummaryDto;
  rangePreset: UsageRangePreset;
}

function formatUtcTimestamp(isoString: string | null): string {
  if (!isoString) return "No recorded activity";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "No recorded activity";
    return d.toUTCString().replace("GMT", "UTC");
  } catch {
    return "No recorded activity";
  }
}

const RANGE_LABELS: Record<UsageRangePreset, string> = {
  "24h": "Past 24 Hours",
  "7d": "Past 7 Days",
  "30d": "Past 30 Days",
  month: "Current Calendar Month",
  custom: "Selected Custom Range",
};

export function UsageSummaryCards({ summary, rangePreset }: UsageSummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Selected Range Total Usage */}
      <div className="p-5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {RANGE_LABELS[rangePreset]}
          </span>
          <Layers className="h-4 w-4 text-neutral-400" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-neutral-900 dark:text-neutral-100">
            {summary.totalUnits.toLocaleString()}
          </span>
          <span className="text-xs text-neutral-500">
            {summary.totalUnits === 1 ? "unit" : "units"}
          </span>
        </div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Successful image transformations
        </div>
      </div>

      {/* 2. Current Month Usage */}
      <div className="p-5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Month-to-Date (UTC)
          </span>
          <Activity className="h-4 w-4 text-neutral-400" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-neutral-900 dark:text-neutral-100">
            {summary.currentMonthUnits.toLocaleString()}
          </span>
          <span className="text-xs text-neutral-500">
            {summary.currentMonthUnits === 1 ? "unit" : "units"}
          </span>
        </div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Recorded usage units this month
        </div>
      </div>

      {/* 3. Active API Keys */}
      <div className="p-5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Active API Keys
          </span>
          <Key className="h-4 w-4 text-neutral-400" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-2xl font-bold font-mono tracking-tight text-neutral-900 dark:text-neutral-100">
            {summary.activeKeysCount}
          </span>
          <span className="text-xs text-neutral-500">
            {summary.activeKeysCount === 1 ? "active key" : "active keys"}
          </span>
        </div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Authorized transformation credentials
        </div>
      </div>

      {/* 4. Quota State (Truthful) */}
      <div className="p-5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            Monthly Quota
          </span>
          <ShieldCheck className="h-4 w-4 text-neutral-400" />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {summary.quota.configured ? `${summary.quota.allowedMonthlyUnits} units` : "No quota configured"}
          </span>
        </div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
          {summary.latestEventAt ? `Latest: ${formatUtcTimestamp(summary.latestEventAt)}` : "No activity recorded yet"}
        </div>
      </div>
    </div>
  );
}
