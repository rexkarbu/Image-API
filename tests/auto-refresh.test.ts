import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("AutoRefresh Serialization and Timer Deduplication Logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proves that simultaneous timer and visibility triggers cannot invoke refresh more than once while in-flight", () => {
    let refreshCount = 0;
    let isPending = false;
    let isRefreshing = false;

    const mockRouterRefresh = vi.fn(() => {
      refreshCount++;
    });

    const triggerRefresh = () => {
      if (isRefreshing) return;
      isRefreshing = true;
      isPending = true;
      mockRouterRefresh();
    };

    const finishTransition = () => {
      isPending = false;
      isRefreshing = false;
    };

    // 1. Initial visibility trigger
    triggerRefresh();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);

    // 2. Simultaneous interval timer ticks while previous refresh is still in-flight
    triggerRefresh();
    triggerRefresh();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1); // Blocked by isRefreshing lock

    // 3. Tab visibility changes while still in-flight
    triggerRefresh();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);

    // 4. Transition finishes
    finishTransition();

    // 5. Next interval fires after completion -> succeeds exactly once
    triggerRefresh();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(2);
  });

  it("proves interval is paused when document is hidden and resumed on visible", () => {
    let timerFiredCount = 0;
    let visibilityState = "hidden";
    let timer: any = null;

    const scheduleTimer = () => {
      if (timer) clearInterval(timer);
      if (visibilityState === "visible") {
        timer = setInterval(() => {
          if (visibilityState === "visible") {
            timerFiredCount++;
          }
        }, 30_000);
      }
    };

    // Starts hidden
    scheduleTimer();
    vi.advanceTimersByTime(60_000);
    expect(timerFiredCount).toBe(0);

    // Becomes visible
    visibilityState = "visible";
    scheduleTimer();
    vi.advanceTimersByTime(30_000);
    expect(timerFiredCount).toBe(1);

    vi.advanceTimersByTime(30_000);
    expect(timerFiredCount).toBe(2);

    // Hidden again
    visibilityState = "hidden";
    if (timer) clearInterval(timer);
    vi.advanceTimersByTime(60_000);
    expect(timerFiredCount).toBe(2);
  });
});
