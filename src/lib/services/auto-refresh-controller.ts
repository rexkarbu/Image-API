export interface RefreshControllerOptions {
  refreshFn: () => void;
  getVisibilityState?: () => DocumentVisibilityState;
  addVisibilityListener?: (listener: () => void) => () => void;
  intervalMs?: number;
}

/**
 * Production auto-refresh coordinator managing tab visibility state,
 * interval timer scheduling, and synchronous in-flight transition gating.
 */
export class AutoRefreshController {
  private readonly refreshFn: () => void;
  private readonly getVisibilityState: () => DocumentVisibilityState;
  private readonly addVisibilityListener: (listener: () => void) => () => void;
  private readonly intervalMs: number;
  private isRefreshing = false;
  private timer: NodeJS.Timeout | number | null = null;
  private removeVisibilityListener: (() => void) | null = null;

  constructor(options: RefreshControllerOptions) {
    this.refreshFn = options.refreshFn;
    this.getVisibilityState =
      options.getVisibilityState ||
      (() => (typeof document !== "undefined" ? document.visibilityState : "visible"));
    this.addVisibilityListener =
      options.addVisibilityListener ||
      ((listener) => {
        if (typeof document === "undefined") return () => {};
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      });
    this.intervalMs = options.intervalMs ?? 30_000;
  }

  /**
   * Attempts to trigger a refresh. If a refresh is currently in flight, returns false.
   */
  public trigger(): boolean {
    if (this.isRefreshing) {
      return false;
    }
    this.isRefreshing = true;
    try {
      this.refreshFn();
      return true;
    } catch (err) {
      this.isRefreshing = false;
      throw err;
    }
  }

  /**
   * Signals that the server transition has settled, releasing the in-flight lock.
   */
  public setSettled(): void {
    this.isRefreshing = false;
  }

  /**
   * Returns whether a refresh operation is currently in flight.
   */
  public getInFlight(): boolean {
    return this.isRefreshing;
  }

  /**
   * Starts the visibility listener and timer scheduling.
   */
  public start(): void {
    this.removeVisibilityListener = this.addVisibilityListener(() => {
      this.handleVisibilityChange();
    });
    this.scheduleTimer();
  }

  /**
   * Responds to tab visibility transitions: triggers refresh and resumes timers on visible,
   * pauses timers when hidden.
   */
  public handleVisibilityChange(): void {
    if (this.getVisibilityState() === "visible") {
      this.trigger();
      this.scheduleTimer();
    } else {
      this.clearTimer();
    }
  }

  /**
   * Schedules a recurring interval timer if the document is visible.
   */
  public scheduleTimer(): void {
    this.clearTimer();
    if (this.getVisibilityState() === "visible") {
      this.timer = setInterval(() => {
        if (this.getVisibilityState() === "visible") {
          this.trigger();
        }
      }, this.intervalMs);
    }
  }

  /**
   * Clears the active interval timer.
   */
  public clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer as any);
      this.timer = null;
    }
  }

  /**
   * Cleans up all listeners and timers upon component unmount.
   */
  public destroy(): void {
    this.clearTimer();
    if (this.removeVisibilityListener) {
      this.removeVisibilityListener();
      this.removeVisibilityListener = null;
    }
  }
}
