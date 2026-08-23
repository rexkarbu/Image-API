import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutoRefreshController } from "@/lib/services/auto-refresh-controller";

describe("Production AutoRefreshController Unit Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proves that simultaneous interval and visibility triggers call refresh exactly once while in-flight", () => {
    const refreshFn = vi.fn();
    let currentVisibility: DocumentVisibilityState = "visible";
    let visibilityListener: (() => void) | null = null;

    const controller = new AutoRefreshController({
      refreshFn,
      getVisibilityState: () => currentVisibility,
      addVisibilityListener: (listener) => {
        visibilityListener = listener;
        return () => {
          visibilityListener = null;
        };
      },
      intervalMs: 30_000,
    });

    controller.start();

    // 1. Initial trigger (e.g. interval tick)
    vi.advanceTimersByTime(30_000);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(controller.getInFlight()).toBe(true);

    // 2. Simultaneous interval ticks while still in-flight
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // 3. Simultaneous visibility change while still in-flight
    if (visibilityListener) {
      (visibilityListener as () => void)();
    }
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // 4. Simultaneous manual trigger while still in-flight is rejected
    const triggered = controller.trigger();
    expect(triggered).toBe(false);
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // 5. Server transition settles
    controller.setSettled();
    expect(controller.getInFlight()).toBe(false);

    // 6. Next trigger succeeds now that lock is released
    const nextTriggered = controller.trigger();
    expect(nextTriggered).toBe(true);
    expect(refreshFn).toHaveBeenCalledTimes(2);

    controller.destroy();
  });

  it("proves timers pause when tab is hidden, resume when visible, and clean up on destroy", () => {
    const refreshFn = vi.fn();
    let currentVisibility: DocumentVisibilityState = "hidden";
    let visibilityListener: (() => void) | null = null;

    const controller = new AutoRefreshController({
      refreshFn,
      getVisibilityState: () => currentVisibility,
      addVisibilityListener: (listener) => {
        visibilityListener = listener;
        return () => {
          visibilityListener = null;
        };
      },
      intervalMs: 30_000,
    });

    controller.start();

    // While hidden, interval does not fire
    vi.advanceTimersByTime(60_000);
    expect(refreshFn).toHaveBeenCalledTimes(0);

    // Tab becomes visible -> triggers refresh immediately and resumes 30s timer
    currentVisibility = "visible";
    if (visibilityListener) {
      (visibilityListener as () => void)();
    }
    expect(refreshFn).toHaveBeenCalledTimes(1);

    // Settles
    controller.setSettled();

    // 30 seconds pass while visible -> timer fires
    vi.advanceTimersByTime(30_000);
    expect(refreshFn).toHaveBeenCalledTimes(2);

    // Tab becomes hidden -> clears timer
    controller.setSettled();
    currentVisibility = "hidden";
    if (visibilityListener) {
      (visibilityListener as () => void)();
    }
    vi.advanceTimersByTime(60_000);
    expect(refreshFn).toHaveBeenCalledTimes(2);

    // Destroy controller
    controller.destroy();
    expect(visibilityListener).toBeNull();
  });
});
