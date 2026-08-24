import "server-only";
import { eq, and, sql, lt, isNull, inArray } from "drizzle-orm";
import { db, DbClient } from "@/db";
import {
  billingWorkerLeases,
  billingWebhookEvents,
  billingCustomers,
  billingSubscriptions,
  billingUsageBatches,
  billingUsageBatchItems,
  usageEvents,
  BillingUsageBatch,
} from "@/db/schema";
import { getStripeClient } from "@/lib/stripe/client";
import { getValidatedStripeConfig } from "@/lib/stripe/safety";
import { processWebhookEventRecord } from "./billing-webhooks";
import { provisionStripeCustomer } from "./billing-customers";
import { STRIPE_METER_EVENT_ID_PREFIX, MAX_USAGE_BATCH_SIZE } from "@/lib/stripe/config";
import Stripe from "stripe";

const WORKER_NAME = "billing_primary_worker";
const LEASE_DURATION_MS = 60 * 1000; // 60 seconds

export interface WorkerRunResult {
  processedWebhooks: number;
  provisionedCustomers: number;
  createdBatches: number;
  reportedBatches: number;
  errors: string[];
}

/**
 * Attempts to acquire a distributed database-backed worker lease.
 * Safe against concurrent workers and recovers automatically from expired leases.
 */
export async function acquireWorkerLease(
  leaseToken: string,
  client: DbClient = db
): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

  const result = await client
    .insert(billingWorkerLeases)
    .values({
      workerName: WORKER_NAME,
      leaseToken,
      leaseExpiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: billingWorkerLeases.workerName,
      set: {
        leaseToken,
        leaseExpiresAt,
        updatedAt: now,
      },
      where: lt(billingWorkerLeases.leaseExpiresAt, now),
    })
    .returning();

  return result.length > 0 && result[0].leaseToken === leaseToken;
}

export async function releaseWorkerLease(
  leaseToken: string,
  client: DbClient = db
): Promise<void> {
  await client
    .delete(billingWorkerLeases)
    .where(
      and(
        eq(billingWorkerLeases.workerName, WORKER_NAME),
        eq(billingWorkerLeases.leaseToken, leaseToken)
      )
    );
}

/**
 * Eligible subscription statuses that permit metered usage reporting.
 */
export const BILLABLE_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "paused",
] as const;

/**
 * Claims unbatched eligible usage events for an organization and creates a closed batch.
 * Database transaction claims rows and commits before calling external Stripe APIs.
 */
async function claimUsageBatchForTenant(
  organizationId: string,
  stripeCustomerId: string,
  meteringEnabledAt: Date,
  client: DbClient,
  targetWindowEnd?: Date
): Promise<BillingUsageBatch | null> {
  const now = new Date();
  // Reporting window: closed usage up to 1 minute ago by default, or caller-specified targetWindowEnd
  const windowEnd = targetWindowEnd || new Date(now.getTime() - 60 * 1000);
  const windowStart = meteringEnabledAt;

  if (windowEnd <= windowStart) {
    return null;
  }

  return await client.transaction(async (tx) => {
    // Find usage events for this organization that are NOT yet in billing_usage_batch_items
    const unbatchedEvents = await tx
      .select({
        id: usageEvents.id,
        units: usageEvents.units,
        createdAt: usageEvents.createdAt,
      })
      .from(usageEvents)
      .leftJoin(
        billingUsageBatchItems,
        eq(usageEvents.id, billingUsageBatchItems.usageEventId)
      )
      .where(
        and(
          eq(usageEvents.organizationId, organizationId),
          isNull(billingUsageBatchItems.usageEventId),
          sql`${usageEvents.createdAt} >= ${windowStart}`,
          sql`${usageEvents.createdAt} < ${windowEnd}`
        )
      )
      .limit(MAX_USAGE_BATCH_SIZE);

    if (unbatchedEvents.length === 0) {
      return null;
    }

    const totalUnits = unbatchedEvents.reduce((acc, e) => acc + e.units, 0);
    if (totalUnits <= 0) return null;

    const batchId = crypto.randomUUID();
    const meterEventIdentifier = `${STRIPE_METER_EVENT_ID_PREFIX}${batchId.replace(/-/g, "")}`;

    const [batch] = await tx
      .insert(billingUsageBatches)
      .values({
        id: batchId,
        organizationId,
        stripeCustomerId,
        windowStart,
        windowEnd,
        units: totalUnits,
        meterEventIdentifier,
        status: "pending",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Map each usage event to this batch; unique constraint on usage_event_id prevents double-claiming
    const batchItems = unbatchedEvents.map((e) => ({
      batchId,
      usageEventId: e.id,
      organizationId,
    }));

    await tx.insert(billingUsageBatchItems).values(batchItems);

    return batch;
  });
}

/**
 * Submits a Stripe Billing Meter Event for a closed usage batch.
 * Executed completely outside of database transactions.
 */
async function reportBatchToStripe(
  batch: BillingUsageBatch,
  client: DbClient
): Promise<boolean> {
  const config = getValidatedStripeConfig();
  const stripe = getStripeClient();

  const timestampSeconds = Math.floor(batch.windowEnd.getTime() / 1000);

  // Stripe Billing Meter Events must be within documented time bounds (within past 35 days)
  const thirtyFiveDaysAgoSeconds = Math.floor((Date.now() - 35 * 86400 * 1000) / 1000);
  if (timestampSeconds < thirtyFiveDaysAgoSeconds) {
    // Too old for truthful Stripe meter reporting: mark for manual review
    await client
      .update(billingUsageBatches)
      .set({
        status: "manual_review",
        errorCode: "timestamp_out_of_bounds",
        updatedAt: new Date(),
      })
      .where(eq(billingUsageBatches.id, batch.id));
    return false;
  }

  try {
    await stripe.billing.meterEvents.create({
      event_name: config.meterEventName,
      payload: {
        stripe_customer_id: batch.stripeCustomerId,
        value: String(batch.units),
      },
      identifier: batch.meterEventIdentifier,
      timestamp: timestampSeconds,
    });

    await client
      .update(billingUsageBatches)
      .set({
        status: "reported",
        reportedAt: new Date(),
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(billingUsageBatches.id, batch.id));

    return true;
  } catch (error) {
    let errorCode = "meter_event_error";
    if (error instanceof Stripe.errors.StripeError) {
      errorCode = error.code || error.type || "stripe_error";
    }

    const nextAttempt = batch.attemptCount + 1;
    const backoffMs = Math.min(3600 * 1000, Math.pow(2, nextAttempt) * 5000);

    await client
      .update(billingUsageBatches)
      .set({
        status: nextAttempt >= 5 ? "failed" : "pending",
        attemptCount: nextAttempt,
        nextRetryAt: new Date(Date.now() + backoffMs),
        errorCode,
        updatedAt: new Date(),
      })
      .where(eq(billingUsageBatches.id, batch.id));

    return false;
  }
}

/**
 * Main background billing worker execution routine.
 */
export async function runBillingWorker(
  client: DbClient = db,
  options?: { windowEnd?: Date }
): Promise<WorkerRunResult> {
  const leaseToken = crypto.randomUUID();
  const acquired = await acquireWorkerLease(leaseToken, client);

  if (!acquired) {
    return {
      processedWebhooks: 0,
      provisionedCustomers: 0,
      createdBatches: 0,
      reportedBatches: 0,
      errors: ["Could not acquire worker lease (another worker is currently active)."],
    };
  }

  const result: WorkerRunResult = {
    processedWebhooks: 0,
    provisionedCustomers: 0,
    createdBatches: 0,
    reportedBatches: 0,
    errors: [],
  };

  try {
    // 1. Process pending webhook inbox events
    const pendingEvents = await client
      .select()
      .from(billingWebhookEvents)
      .where(
        and(
          eq(billingWebhookEvents.status, "pending"),
          sql`${billingWebhookEvents.nextRetryAt} IS NULL OR ${billingWebhookEvents.nextRetryAt} <= now()`
        )
      )
      .limit(50);

    for (const evt of pendingEvents) {
      try {
        await processWebhookEventRecord(evt, client);
        result.processedWebhooks++;
      } catch (err) {
        result.errors.push(`Webhook ${evt.id} failed: ${(err as Error).message}`);
      }
    }

    // 2. Provision pending or failed retryable customers
    const pendingCustomers = await client
      .select()
      .from(billingCustomers)
      .where(
        and(
          inArray(billingCustomers.provisioningStatus, ["pending", "failed"]),
          sql`${billingCustomers.attemptCount} < 10`,
          sql`${billingCustomers.nextRetryAt} IS NULL OR ${billingCustomers.nextRetryAt} <= now()`
        )
      )
      .limit(20);

    for (const cust of pendingCustomers) {
      try {
        await provisionStripeCustomer(cust.organizationId, client);
        result.provisionedCustomers++;
      } catch (err) {
        result.errors.push(`Customer ${cust.organizationId} provisioning failed: ${(err as Error).message}`);
      }
    }

    // 3. Batch and report usage for organizations with active/billable subscriptions
    const activeSubs = await client
      .select({
        organizationId: billingSubscriptions.organizationId,
        stripeCustomerId: billingSubscriptions.stripeCustomerId,
        meteringEnabledAt: billingSubscriptions.meteringEnabledAt,
      })
      .from(billingSubscriptions)
      .where(
        inArray(billingSubscriptions.status, BILLABLE_SUBSCRIPTION_STATUSES as readonly string[])
      );

    for (const sub of activeSubs) {
      try {
        const batch = await claimUsageBatchForTenant(
          sub.organizationId,
          sub.stripeCustomerId,
          sub.meteringEnabledAt,
          client,
          options?.windowEnd
        );

        if (batch) {
          result.createdBatches++;
          const success = await reportBatchToStripe(batch, client);
          if (success) {
            result.reportedBatches++;
          }
        }
      } catch (err) {
        result.errors.push(`Usage claiming failed for org ${sub.organizationId}: ${(err as Error).message}`);
      }
    }

    // 4. Retry pending/failed usage batches
    const pendingBatches = await client
      .select()
      .from(billingUsageBatches)
      .where(
        and(
          eq(billingUsageBatches.status, "pending"),
          sql`${billingUsageBatches.attemptCount} > 0`,
          sql`${billingUsageBatches.nextRetryAt} IS NULL OR ${billingUsageBatches.nextRetryAt} <= now()`
        )
      )
      .limit(20);

    for (const batch of pendingBatches) {
      try {
        const success = await reportBatchToStripe(batch, client);
        if (success) {
          result.reportedBatches++;
        }
      } catch (err) {
        result.errors.push(`Batch retry ${batch.id} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await releaseWorkerLease(leaseToken, client);
  }

  return result;
}
