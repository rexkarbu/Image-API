import { UsageKeyBreakdownDto } from "@/types/usage";
import Link from "next/link";
import { Key } from "lucide-react";

interface UsageKeyBreakdownProps {
  keyBreakdown: UsageKeyBreakdownDto[];
  totalUnits: number;
}

export function UsageKeyBreakdown({ keyBreakdown, totalUnits }: UsageKeyBreakdownProps) {
  if (keyBreakdown.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Usage by API Key
          </h2>
          <Link
            href="/dashboard/api-keys"
            className="text-xs font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
          >
            Manage keys →
          </Link>
        </div>
        <div className="p-6 text-center rounded-md border border-dashed border-neutral-200 dark:border-neutral-800 space-y-1">
          <p className="text-xs font-mono text-neutral-500">No API keys found</p>
          <p className="text-[11px] text-neutral-400">
            Create an API key in the API Keys section to start transforming images.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Usage by API Key
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Breakdown across keys for selected period
          </p>
        </div>
        <Link
          href="/dashboard/api-keys"
          className="text-xs font-medium text-neutral-900 dark:text-neutral-100 hover:underline"
        >
          Manage keys →
        </Link>
      </div>

      <div className="space-y-3">
        {keyBreakdown.map((key) => {
          const percentValue = key.percentage ?? 0;
          return (
            <div
              key={key.apiKeyId}
              className="p-3.5 rounded-lg border border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/40 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 min-w-0">
                  <Key className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                  <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                    {key.name}
                  </span>
                  <span className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 truncate">
                    {key.maskedKey}
                  </span>
                </div>

                <div className="flex items-center space-x-3 shrink-0">
                  <span className="text-xs font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                    {key.units.toLocaleString()} {key.units === 1 ? "unit" : "units"}
                  </span>
                  <span className="text-xs font-mono text-neutral-500 w-12 text-right">
                    {totalUnits > 0 ? `${percentValue.toFixed(1)}%` : "0.0%"}
                  </span>
                </div>
              </div>

              {/* Progress bar (only if totalUnits > 0) */}
              <div className="w-full h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-neutral-900 dark:bg-neutral-100 transition-all duration-300"
                  style={{ width: `${Math.min(Math.max(percentValue, key.units > 0 ? 2 : 0), 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
