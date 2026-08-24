import "server-only";
import { eq, and, sql } from "drizzle-orm";
import { db, DbClient } from "@/db";
import {
  billingSubscriptions,
  billingUsageBatches,
  billingUsageBatchItems,
  billingReconciliationRuns,
  usageEvents,
  BillingReconciliationRun,
} from "@/db/schema";
import { getStripeClient } from "@/lib/stripe/client";
import { getValidatedStripeConfig } from "@/lib/stripe/safety";
import { logger } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracer";
import crypto from "node:crypto";

export interface ReconciliationResult {
  run: BillingReconciliationRun;
  localEligibleUnits: number;
  batchedUnits: number;
  reportedUnits: number;
  stripeAggregatedUnits: number;
  difference: number;
  status: "pending_provider" | "matched" | "mismatch" | "failed";
}

/**
 * Reconciles local usage events and reported batches against Stripe Meter Event Summaries.
 */
export async function runReconciliationForOrganization(
  organizationId: string,
  periodStart: Date,
  periodEnd: Date,
  client: DbClient = db
): Promise<ReconciliationResult> {
  if (periodEnd <= periodStart) {
    throw new Error("Invalid reconciliation period: periodEnd must be greater than periodStart.");
  }

  return withSpan(
    "billing.reconcile",
    async (span) => {
      const [sub] = await client
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.organizationId, organizationId))
        .limit(1);

      if (!sub) {
        throw new Error(`No subscription found for organization ${organizationId}`);
      }

      // 1. Calculate local eligible units in the period
      const eligibleEventsRes = await client
        .select({
          totalUnits: sql<number>`COALESCE(SUM(${usageEvents.units}), 0)`,
        })
        .from(usageEvents)
        .where(
          and(
            eq(usageEvents.organizationId, organizationId),
            sql`${usageEvents.createdAt} >= ${periodStart}`,
            sql`${usageEvents.createdAt} < ${periodEnd}`,
            sql`${usageEvents.createdAt} >= ${sub.meteringEnabledAt}`
          )
        );
      const localEligibleUnits = Number(eligibleEventsRes[0]?.totalUnits ?? 0);

      // 2. Calculate local batched units mapped through billing_usage_batch_items
      const batchedItemsRes = await client
        .select({
          totalUnits: sql<number>`COALESCE(SUM(${usageEvents.units}), 0)`,
        })
        .from(billingUsageBatchItems)
        .innerJoin(usageEvents, eq(billingUsageBatchItems.usageEventId, usageEvents.id))
        .where(
          and(
            eq(billingUsageBatchItems.organizationId, organizationId),
            sql`${usageEvents.createdAt} >= ${periodStart}`,
            sql`${usageEvents.createdAt} < ${periodEnd}`
          )
        );
      const batchedUnits = Number(batchedItemsRes[0]?.totalUnits ?? 0);

      // 3. Calculate reported units from billing_usage_batches
      const reportedBatchesRes = await client
        .select({
          totalUnits: sql<number>`COALESCE(SUM(${billingUsageBatches.units}), 0)`,
        })
        .from(billingUsageBatches)
        .where(
          and(
            eq(billingUsageBatches.organizationId, organizationId),
            eq(billingUsageBatches.status, "reported"),
            sql`${billingUsageBatches.windowStart} >= ${periodStart}`,
            sql`${billingUsageBatches.windowEnd} <= ${periodEnd}`
          )
        );
      const reportedUnits = Number(reportedBatchesRes[0]?.totalUnits ?? 0);

      // 4. Query Stripe Meter Event Summaries for provider-side aggregated units
      const config = getValidatedStripeConfig();
      const stripe = getStripeClient();

      const startTimeSec = Math.floor(periodStart.getTime() / 1000);
      const endTimeSec = Math.floor(periodEnd.getTime() / 1000);

      let stripeAggregatedUnits = 0;
      let status: "pending_provider" | "matched" | "mismatch" | "failed" = "matched";
      let errorCode: string | null = null;

      try {
        const summaries = await stripe.billing.meters.listEventSummaries(config.meterId, {
          customer: sub.stripeCustomerId,
          start_time: startTimeSec,
          end_time: endTimeSec,
        });

        for (const summary of summaries.data) {
          stripeAggregatedUnits += summary.aggregated_value;
        }

        const diff = reportedUnits - stripeAggregatedUnits;

        if (diff === 0) {
          status = "matched";
        } else {
          // If events were reported very recently (< 15 minutes ago), Stripe's aggregation pipeline may be catching up
          const now = Date.now();
          const isRecentWindow = periodEnd.getTime() > now - 15 * 60 * 1000;
          if (isRecentWindow && stripeAggregatedUnits < reportedUnits) {
            status = "pending_provider";
          } else {
            status = "mismatch";
          }
        }
      } catch (err) {
        status = "failed";
        errorCode = (err as Error).name || "stripe_summary_error";
      }

      const difference = reportedUnits - stripeAggregatedUnits;
      const runId = crypto.randomUUID();
      const now = new Date();

      const [run] = await client
        .insert(billingReconciliationRuns)
        .values({
          id: runId,
          organizationId,
          periodStart,
          periodEnd,
          localEligibleUnits,
          batchedUnits,
          reportedUnits,
          stripeAggregatedUnits,
          difference,
          status,
          errorCode,
          startedAt: now,
          completedAt: now,
          createdAt: now,
        })
        .returning();

      span.setAttribute("billing.reconcile_status", status);
      span.setAttribute("billing.difference", difference);

      logger.info("billing.reconciliation_completed", {
        details: {
          organizationId,
          status,
          localEligibleUnits,
          batchedUnits,
          reportedUnits,
          stripeAggregatedUnits,
          difference,
        },
      });

      return {
        run,
        localEligibleUnits,
        batchedUnits,
        reportedUnits,
        stripeAggregatedUnits,
        difference,
        status,
      };
    },
    { "billing.operation": "reconciliation" }
  );
}
