"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { UsageFilters, UsageRangePreset, FilterOptionDto } from "@/types/usage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, X } from "lucide-react";

interface UsageFiltersBarProps {
  activeFilters: UsageFilters;
  filterOptions: FilterOptionDto;
}

const RANGE_PRESETS: { value: UsageRangePreset; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

export function UsageFiltersBar({ activeFilters, filterOptions }: UsageFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [customFrom, setCustomFrom] = useState<string>(
    activeFilters.from ? activeFilters.from.substring(0, 10) : ""
  );
  const [customTo, setCustomTo] = useState<string>(
    activeFilters.to ? activeFilters.to.substring(0, 10) : ""
  );

  const applyFilters = (updates: Partial<UsageFilters>) => {
    const params = new URLSearchParams(searchParams?.toString() || "");

    // Clear cursor on filter change
    params.delete("cursor");

    const newRange = updates.range !== undefined ? updates.range : activeFilters.range;
    if (newRange && newRange !== "30d") {
      params.set("range", newRange);
    } else {
      params.delete("range");
    }

    if (newRange === "custom") {
      const fromVal = updates.from !== undefined ? updates.from : activeFilters.from;
      const toVal = updates.to !== undefined ? updates.to : activeFilters.to;
      if (fromVal) params.set("from", fromVal);
      if (toVal) params.set("to", toVal);
    } else {
      params.delete("from");
      params.delete("to");
    }

    const newApiKeyId = updates.apiKeyId !== undefined ? updates.apiKeyId : activeFilters.apiKeyId;
    if (newApiKeyId) {
      params.set("apiKeyId", newApiKeyId);
    } else {
      params.delete("apiKeyId");
    }

    const newEndpoint = updates.endpoint !== undefined ? updates.endpoint : activeFilters.endpoint;
    if (newEndpoint) {
      params.set("endpoint", newEndpoint);
    } else {
      params.delete("endpoint");
    }

    const newStatusCode = updates.statusCode !== undefined ? updates.statusCode : activeFilters.statusCode;
    if (newStatusCode) {
      params.set("statusCode", String(newStatusCode));
    } else {
      params.delete("statusCode");
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  const handleResetFilters = () => {
    router.push(pathname);
  };

  const handleCustomApply = () => {
    if (!customFrom || !customTo) return;
    const fromDate = new Date(`${customFrom}T00:00:00.000Z`);
    const toDate = new Date(`${customTo}T23:59:59.999Z`);
    if (fromDate <= toDate) {
      applyFilters({
        range: "custom",
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      });
    }
  };

  const hasActiveFilters =
    activeFilters.range !== "30d" ||
    !!activeFilters.apiKeyId ||
    !!activeFilters.endpoint ||
    !!activeFilters.statusCode;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Date Range Presets */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date Range Presets">
          {RANGE_PRESETS.map((preset) => {
            const isSelected = activeFilters.range === preset.value;
            return (
              <Button
                key={preset.value}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => applyFilters({ range: preset.value })}
                className={`h-7 px-2.5 text-xs font-mono ${
                  isSelected
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 dark:text-neutral-400"
                }`}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="h-7 px-2 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 space-x-1"
          >
            <X className="h-3 w-3" />
            <span>Reset filters</span>
          </Button>
        )}
      </div>

      {/* Custom Date Range Selector (Only when custom selected) */}
      {activeFilters.range === "custom" && (
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <label htmlFor="custom-from" className="font-medium text-neutral-500">From:</label>
            <Input
              id="custom-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 text-xs font-mono w-36"
            />
          </div>
          <div className="flex items-center space-x-2">
            <label htmlFor="custom-to" className="font-medium text-neutral-500">To:</label>
            <Input
              id="custom-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 text-xs font-mono w-36"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCustomApply}
            disabled={!customFrom || !customTo}
            className="h-8 text-xs px-3"
          >
            Apply Range
          </Button>
        </div>
      )}

      {/* Granular Filters: API Key, Endpoint, Status Code */}
      <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        {/* API Key Selector */}
        <div className="space-y-1">
          <label htmlFor="filter-api-key" className="block text-[11px] font-medium text-neutral-500">
            API Key
          </label>
          <select
            id="filter-api-key"
            value={activeFilters.apiKeyId || ""}
            onChange={(e) => applyFilters({ apiKeyId: e.target.value || undefined })}
            className="w-full h-8 px-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-sans text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-400"
          >
            <option value="">All API Keys</option>
            {filterOptions.apiKeyOptions.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.maskedKey})
              </option>
            ))}
          </select>
        </div>

        {/* Endpoint Selector */}
        <div className="space-y-1">
          <label htmlFor="filter-endpoint" className="block text-[11px] font-medium text-neutral-500">
            Endpoint
          </label>
          <select
            id="filter-endpoint"
            value={activeFilters.endpoint || ""}
            onChange={(e) => applyFilters({ endpoint: e.target.value || undefined })}
            className="w-full h-8 px-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-mono text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-400"
          >
            <option value="">All Endpoints</option>
            {filterOptions.endpointOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        {/* Status Code Selector */}
        <div className="space-y-1">
          <label htmlFor="filter-status-code" className="block text-[11px] font-medium text-neutral-500">
            Status Code
          </label>
          <select
            id="filter-status-code"
            value={activeFilters.statusCode ? String(activeFilters.statusCode) : ""}
            onChange={(e) =>
              applyFilters({
                statusCode: e.target.value ? parseInt(e.target.value, 10) : undefined,
              })
            }
            className="w-full h-8 px-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-mono text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-400"
          >
            <option value="">All Status Codes</option>
            {filterOptions.statusCodeOptions.map((s) => (
              <option key={s} value={String(s)}>
                {s} OK
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
