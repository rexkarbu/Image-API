import { describe, it, expect } from "vitest";

describe("Billing Reconciliation Arithmetic & State Transitions", () => {
  function computeReconciliationState(
    reportedUnits: number,
    stripeAggregatedUnits: number,
    isRecentWindow: boolean
  ): { difference: number; status: "matched" | "pending_provider" | "mismatch" } {
    const difference = reportedUnits - stripeAggregatedUnits;
    if (difference === 0) {
      return { difference, status: "matched" };
    }
    if (isRecentWindow && stripeAggregatedUnits < reportedUnits) {
      return { difference, status: "pending_provider" };
    }
    return { difference, status: "mismatch" };
  }

  it("evaluates matched reconciliation correctly", () => {
    const res = computeReconciliationState(100, 100, false);
    expect(res.difference).toBe(0);
    expect(res.status).toBe("matched");
  });

  it("marks recent lagging provider aggregate as pending_provider", () => {
    const res = computeReconciliationState(100, 80, true);
    expect(res.difference).toBe(20);
    expect(res.status).toBe("pending_provider");
  });

  it("marks settled period difference as mismatch", () => {
    const res = computeReconciliationState(100, 80, false);
    expect(res.difference).toBe(20);
    expect(res.status).toBe("mismatch");
  });
});
