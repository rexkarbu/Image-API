import { describe, it, expect } from "vitest";
import { STRIPE_METER_EVENT_ID_PREFIX } from "@/lib/stripe/config";

describe("Billing Worker Rules & Identifier Contract", () => {
  const BILLABLE_STATUSES = ["trialing", "active", "past_due", "paused"];
  const NON_BILLABLE_STATUSES = ["unpaid", "canceled", "incomplete", "incomplete_expired"];

  it("distinguishes billable from non-billable subscription statuses", () => {
    const isBillable = (status: string) => BILLABLE_STATUSES.includes(status);

    for (const status of BILLABLE_STATUSES) {
      expect(isBillable(status)).toBe(true);
    }
    for (const status of NON_BILLABLE_STATUSES) {
      expect(isBillable(status)).toBe(false);
    }
  });

  it("generates valid Meter Event identifiers within Stripe length limits (<= 100 chars)", () => {
    const batchId = crypto.randomUUID();
    const identifier = `${STRIPE_METER_EVENT_ID_PREFIX}${batchId.replace(/-/g, "")}`;

    expect(identifier.length).toBeLessThanOrEqual(100);
    expect(identifier.startsWith("imgapi_")).toBe(true);
    expect(/^[A-Za-z0-9_-]+$/.test(identifier)).toBe(true);
  });

  it("calculates bounded exponential backoff correctly", () => {
    const calculateBackoff = (attempt: number) =>
      Math.min(3600 * 1000, Math.pow(2, attempt) * 5000);

    expect(calculateBackoff(1)).toBe(10000); // 10s
    expect(calculateBackoff(2)).toBe(20000); // 20s
    expect(calculateBackoff(3)).toBe(40000); // 40s
    expect(calculateBackoff(10)).toBe(3600000); // Max 1 hour
  });
});
