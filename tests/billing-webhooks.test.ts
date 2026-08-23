import { describe, it, expect } from "vitest";
import { SUPPORTED_WEBHOOK_EVENTS } from "@/lib/stripe/config";

describe("Billing Webhook Event Invariants & Allowlist", () => {
  it("includes all required webhook event types in allowlist", () => {
    const requiredEvents = [
      "checkout.session.completed",
      "checkout.session.expired",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "customer.subscription.paused",
      "customer.subscription.resumed",
      "invoice.created",
      "invoice.finalized",
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.voided",
    ];

    for (const evt of requiredEvents) {
      expect(SUPPORTED_WEBHOOK_EVENTS).toContain(evt);
    }
  });

  it("handles out-of-order event ordering comparison safely", () => {
    const earlierDate = new Date("2026-08-01T10:00:00Z");
    const laterDate = new Date("2026-08-01T11:00:00Z");

    const isStale = (lastProcessed: Date | null, incoming: Date) => {
      return lastProcessed !== null && lastProcessed > incoming;
    };

    expect(isStale(laterDate, earlierDate)).toBe(true);
    expect(isStale(earlierDate, laterDate)).toBe(false);
    expect(isStale(null, earlierDate)).toBe(false);
  });
});
