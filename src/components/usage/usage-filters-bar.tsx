"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { UsageFilters, UsageRangePreset, FilterOptionDto } from "@/types/usage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, AlertCircle, RotateCcw } from "lucide-react";
import {
  computeCalendarDayStartUtc,
  computeCalendarDayEndUtc,
  MAX_CUSTOM_RANGE_DAYS,
} from "@/lib/validations/usage-filters";

interface UsageFiltersBarProps {
  activeFilters: UsageFilters;
  filterOptions: FilterOptionDto;
  filterError?: string | null;
}

const RANGE_PRESETS: { value: UsageRangePreset; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
];

function CustomDateRangePanel({
  initialFrom,
  initialTo,
  onApply,
}: {
  initialFrom?: string;
  initialTo?: string;
  onApply: (fromIso: string, toIso: string) => void;
}) {
  const [customFrom, setCustomFrom] = useState<string>(
    initialFrom ? initialFrom.substring(0, 10) : ""
  );
  const [customTo, setCustomTo] = useState<string>(
    initialTo
      ? (() => {
          const d = new Date(initialTo);
          d.setUTCDate(d.getUTCDate() - 1);
          return d.toISOString().substring(0, 10);
        })()
      : ""
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const handleApply = () => {
    setLocalError(null);
    if (!customFrom || !customTo) {
      setLocalError("Please select both start and end calendar dates.");
      return;
    }

    const fromUtc = computeCalendarDayStartUtc(customFrom);
    const toUtc = computeCalendarDayEndUtc(customTo);

    if (!fromUtc || !toUtc) {
      setLocalError("Invalid calendar date selection.");
      return;
    }

    const fromMs = new Date(fromUtc).getTime();
    const toMs = new Date(toUtc).getTime();

    if (fromMs >= toMs) {
      setLocalError("Start date must be on or before end date.");
      return;
    }

    const diffDays = (toMs - fromMs) / (24 * 60 * 60 * 1000);
    if (diffDays > MAX_CUSTOM_RANGE_DAYS) {
      setLocalError(`Custom date range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} calendar days.`);
      return;
    }

    onApply(fromUtc, toUtc);
  };

  return (
    <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
      <div className="flex flex-wrap items-center gap-2.5 text-xs">
        <div className="flex items-center space-x-1.5">
          <label htmlFor="custom-from" className="font-medium text-neutral-500 text-[11px]">
            From:
          </label>
          <Input
            id="custom-from"
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              setLocalError(null);
            }}
            className="h-8 text-xs font-mono w-36"
          />
        </div>

        <div className="flex items-center space-x-1.5">
          <label htmlFor="custom-to" className="font-medium text-neutral-500 text-[11px]">
            To:
          </label>
          <Input
            id="custom-to"
            type="date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              setLocalError(null);
            }}
            className="h-8 text-xs font-mono w-36"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleApply}
          disabled={!customFrom || !customTo}
          className="h-8 text-xs px-3 font-medium"
        >
          Apply Range
        </Button>
      </div>

      {localError && (
        <p className="text-[11px] text-red-600 dark:text-red-400 font-medium">
          {localError}
        </p>
      )}
    </div>
  );
}

export function UsageFiltersBar({
  activeFilters,
  filterOptions,
  filterError,
}: UsageFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [isCustomLocallyOpen, setIsCustomLocallyOpen] = useState<boolean>(false);
  const isCustomOpen = isCustomLocallyOpen || activeFilters.range === "custom";

  const applyFilters = (updates: Partial<UsageFilters>) => {
    const params = new URLSearchParams(searchParams?.toString() || "");

    // Clear pagination cursor on any filter change
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

  const handlePresetClick = (preset: UsageRangePreset) => {
    if (preset === "custom") {
      setIsCustomLocallyOpen(true);
      return;
    }

    setIsCustomLocallyOpen(false);
    applyFilters({ range: preset, from: undefined, to: undefined });
  };

  const handleCustomApply = (fromUtc: string, toUtc: string) => {
    setIsCustomLocallyOpen(false);
    applyFilters({
      range: "custom",
      from: fromUtc,
      to: toUtc,
    });
  };

  const handleResetFilters = () => {
    setIsCustomLocallyOpen(false);
    router.push(pathname);
  };

  const hasActiveFilters =
    activeFilters.range !== "30d" ||
    !!activeFilters.apiKeyId ||
    !!activeFilters.endpoint ||
    !!activeFilters.statusCode ||
    !!filterError;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-sm space-y-3">
      {/* Filter Error Notice */}
      {filterError && (
        <div
          role="alert"
          className="p-3 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-amber-800 dark:text-amber-300"
        >
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>{filterError}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetFilters}
            className="h-7 text-xs border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 space-x-1"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset to default</span>
          </Button>
        </div>
      )}

      {/* Preset Buttons & Reset Control */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date Range Presets">
          {RANGE_PRESETS.map((preset) => {
            const isSelected = isCustomOpen
              ? preset.value === "custom"
              : activeFilters.range === preset.value;

            return (
              <Button
                key={preset.value}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => handlePresetClick(preset.value)}
                className={`h-7 px-2.5 text-xs font-mono transition-colors focus-visible:ring-2 ${
                  isSelected
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {preset.label}
              </Button>
            );
          })}
        </div>

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

      {/* Custom Date Range Panel */}
      {isCustomOpen && (
        <CustomDateRangePanel
          key={`${activeFilters.from || ""}_${activeFilters.to || ""}_${activeFilters.range}`}
          initialFrom={activeFilters.from}
          initialTo={activeFilters.to}
          onApply={handleCustomApply}
        />
      )}

      {/* Granular Filters */}
      <div className="pt-2.5 border-t border-neutral-100 dark:border-neutral-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
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
                {s} Success
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
