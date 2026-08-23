"use client";

import { useEffect, useTransition, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutoRefreshController } from "@/lib/services/auto-refresh-controller";

export function AutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const controllerRef = useRef<AutoRefreshController | null>(null);

  // Initialize and manage controller lifecycle in an effect
  useEffect(() => {
    const controller = new AutoRefreshController({
      refreshFn: () => {
        startTransition(() => {
          router.refresh();
        });
      },
    });
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [router]);

  // Update settled state when transition finishes
  useEffect(() => {
    if (!isPending && controllerRef.current) {
      controllerRef.current.setSettled();
    }
  }, [isPending]);

  const handleManualRefresh = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.trigger();
    }
  }, []);

  return (
    <div className="flex items-center space-x-3 text-xs text-neutral-500 dark:text-neutral-400">
      <span className="hidden sm:inline font-mono">
        Auto-refreshes every 30s (active tab)
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleManualRefresh}
        disabled={isPending}
        className="h-8 px-2.5 text-xs font-medium space-x-1.5 focus-visible:ring-2 motion-safe:transition-colors"
        aria-label="Refresh dashboard data"
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${
            isPending ? "motion-safe:animate-spin text-neutral-900 dark:text-neutral-100" : ""
          }`}
        />
        <span>{isPending ? "Refreshing..." : "Refresh"}</span>
      </Button>
    </div>
  );
}
