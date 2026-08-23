"use client";

import { UsagePageDto, UsageFilters } from "@/types/usage";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronRight, RotateCcw } from "lucide-react";

interface UsageEventsTableProps {
  eventsPage: UsagePageDto;
  activeFilters: UsageFilters;
}

function formatEventUtc(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toUTCString().replace("GMT", "UTC");
  } catch {
    return isoString;
  }
}

export function UsageEventsTable({ eventsPage, activeFilters }: UsageEventsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleNextPage = () => {
    if (!eventsPage.nextCursor) return;
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("cursor", eventsPage.nextCursor);
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleResetCursor = () => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("cursor");
    router.push(`${pathname}?${params.toString()}`);
  };

  const isPaginated = !!activeFilters.cursor;

  if (eventsPage.events.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Recent Transformation Events
          </h2>
          {isPaginated && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetCursor}
              className="text-xs h-7 space-x-1"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Back to start</span>
            </Button>
          )}
        </div>

        <div className="p-8 text-center rounded-md border border-dashed border-neutral-200 dark:border-neutral-800 space-y-1">
          <p className="text-xs font-mono text-neutral-500">
            {isPaginated ? "No further events in this page" : "No usage events recorded for this selection"}
          </p>
          <p className="text-[11px] text-neutral-400">
            Events appear automatically after successful image transformations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden space-y-0">
      <div className="p-4 sm:p-5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Recent Transformation Events
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Append-only record of billed image operations
          </p>
        </div>

        {isPaginated && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetCursor}
            className="text-xs h-7 space-x-1.5"
          >
            <RotateCcw className="h-3 w-3" />
            <span>First Page</span>
          </Button>
        )}
      </div>

      {/* Events Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-50/80 dark:bg-neutral-900/60 text-neutral-500 dark:text-neutral-400 font-mono text-[11px] border-b border-neutral-100 dark:border-neutral-800">
            <tr>
              <th scope="col" className="py-2.5 px-4 font-medium whitespace-nowrap">Timestamp (UTC)</th>
              <th scope="col" className="py-2.5 px-4 font-medium whitespace-nowrap">API Key</th>
              <th scope="col" className="py-2.5 px-4 font-medium whitespace-nowrap">Endpoint</th>
              <th scope="col" className="py-2.5 px-4 font-medium whitespace-nowrap">Status</th>
              <th scope="col" className="py-2.5 px-4 font-medium text-right whitespace-nowrap">Units</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 font-mono text-[11px]">
            {eventsPage.events.map((event) => (
              <tr
                key={event.id}
                className="hover:bg-neutral-50/60 dark:hover:bg-neutral-800/30 transition-colors"
              >
                <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                  {formatEventUtc(event.createdAt)}
                </td>
                <td className="py-3 px-4 whitespace-nowrap max-w-[200px]">
                  <div className="font-sans font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {event.apiKeyName}
                  </div>
                  <div className="text-[10px] text-neutral-400 font-mono truncate">
                    {event.maskedKey}
                  </div>
                </td>
                <td className="py-3 px-4 text-neutral-700 dark:text-neutral-300 whitespace-nowrap font-mono">
                  {event.endpoint}
                </td>
                <td className="py-3 px-4 whitespace-nowrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                    {event.statusCode} Success
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-semibold text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                  +{event.units}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3.5 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/40 flex items-center justify-between">
        <span className="text-xs text-neutral-500 font-mono">
          Showing {eventsPage.events.length} {eventsPage.events.length === 1 ? "event" : "events"}
        </span>

        {eventsPage.hasMore && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            className="text-xs h-7 space-x-1 font-medium"
          >
            <span>Next Page</span>
            <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
