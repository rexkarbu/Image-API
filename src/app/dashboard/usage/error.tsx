"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function UsageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log non-sensitive error notice
    console.error("[Usage Dashboard Error] Failed to render usage metrics");
  }, [error]);

  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center p-6 text-center space-y-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
      <div className="h-10 w-10 rounded-full bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/50 flex items-center justify-center text-red-600 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" />
      </div>

      <div className="space-y-1 max-w-md">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Failed to load usage data
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          An error occurred while communicating with the analytics service. Please try again.
        </p>
      </div>

      <Button
        onClick={() => reset()}
        variant="outline"
        size="sm"
        className="text-xs space-x-1.5"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>Try Again</span>
      </Button>
    </div>
  );
}
