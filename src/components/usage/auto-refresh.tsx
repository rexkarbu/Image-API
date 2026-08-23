"use client";

import { useEffect, useTransition, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const REFRESH_INTERVAL_MS = 30_000; // 30 seconds

export function AutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isRefreshingRef = useRef<boolean>(false);

  // Clear in-flight lock only when transition has settled
  useEffect(() => {
    if (!isPending) {
      isRefreshingRef.current = false;
    }
  }, [isPending]);

  const triggerRefresh = useCallback(() => {
    // Synchronous lock guard against overlapping/simultaneous triggers
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const scheduleTimer = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (document.visibilityState === "visible") {
        timer = setInterval(() => {
          if (document.visibilityState === "visible") {
            triggerRefresh();
          }
        }, REFRESH_INTERVAL_MS);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerRefresh();
        scheduleTimer();
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    scheduleTimer();

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [triggerRefresh]);

  return (
    <div className="flex items-center space-x-3 text-xs text-neutral-500 dark:text-neutral-400">
      <span className="hidden sm:inline font-mono">
        Auto-refreshes every 30s (active tab)
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={triggerRefresh}
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
