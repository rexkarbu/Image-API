import "server-only";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, DbClient } from "@/db";
import {
  organizations,
  organizationMembers,
  billingCustomers,
  billingSubscriptions,
  billingInvoices,
  billingUsageBatches,
  billingReconciliationRuns,
  usageEvents,
} from "@/db/schema";
import {
  BillingDashboardData,
  BillingCustomerDto,
  BillingSubscriptionDto,
  BillingInvoiceDto,
  BillingUsageSummaryDto,
} from "@/types/billing";

export async function getBillingDashboardData(
  organizationId: string,
  userId: string,
  client: DbClient = db
): Promise<BillingDashboardData> {
  const [org] = await client
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org) {
    throw new Error(`Organization ${organizationId} not found.`);
  }

  const [membership] = await client
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);

  const isOwner = membership?.role === "owner";

  // 1. Customer profile
  const [cust] = await client
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.organizationId, organizationId))
    .limit(1);

  const customerDto: BillingCustomerDto | null = cust
    ? {
        organizationId: cust.organizationId,
        stripeCustomerId: cust.stripeCustomerId,
        provisioningStatus: cust.provisioningStatus as any,
        livemode: cust.livemode,
        attemptCount: cust.attemptCount,
        lastErrorCode: cust.lastErrorCode,
      }
    : null;

  // 2. Current subscription projection
  const [sub] = await client
    .select()
    .from(billingSubscriptions)
    .where(eq(billingSubscriptions.organizationId, organizationId))
    .orderBy(desc(billingSubscriptions.createdAt))
    .limit(1);

  const subscriptionDto: BillingSubscriptionDto | null = sub
    ? {
        id: sub.id,
        organizationId: sub.organizationId,
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        stripePriceId: sub.stripePriceId,
        status: sub.status as any,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        canceledAt: sub.canceledAt ? sub.canceledAt.toISOString() : null,
        meteringEnabledAt: sub.meteringEnabledAt.toISOString(),
      }
    : null;

  // 3. Period Usage Calculation
  const now = new Date();
  const periodStart = sub
    ? sub.currentPeriodStart
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = sub
    ? sub.currentPeriodEnd
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const localUsageRes = await client
    .select({
      totalUnits: sql<number>`COALESCE(SUM(${usageEvents.units}), 0)`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.organizationId, organizationId),
        sql`${usageEvents.createdAt} >= ${periodStart}`,
        sql`${usageEvents.createdAt} < ${periodEnd}`
      )
    );
  const currentPeriodLocalUnits = Number(localUsageRes[0]?.totalUnits ?? 0);

  const batchStatsRes = await client
    .select({
      status: billingUsageBatches.status,
      units: sql<number>`COALESCE(SUM(${billingUsageBatches.units}), 0)`,
    })
    .from(billingUsageBatches)
    .where(
      and(
        eq(billingUsageBatches.organizationId, organizationId),
        sql`${billingUsageBatches.windowStart} >= ${periodStart}`,
        sql`${billingUsageBatches.windowEnd} <= ${periodEnd}`
      )
    )
    .groupBy(billingUsageBatches.status);

  let reportedUnits = 0;
  let pendingUnits = 0;
  let manualReviewUnits = 0;

  for (const row of batchStatsRes) {
    const u = Number(row.units);
    if (row.status === "reported") reportedUnits += u;
    else if (row.status === "pending" || row.status === "processing") pendingUnits += u;
    else if (row.status === "manual_review" || row.status === "failed") manualReviewUnits += u;
  }

  // 4. Last reconciliation run
  const [lastRecon] = await client
    .select()
    .from(billingReconciliationRuns)
    .where(eq(billingReconciliationRuns.organizationId, organizationId))
    .orderBy(desc(billingReconciliationRuns.createdAt))
    .limit(1);

  const usageDto: BillingUsageSummaryDto = {
    currentPeriodLocalUnits,
    reportedUnits,
    pendingUnits,
    manualReviewUnits,
    lastReconciliationStatus: lastRecon ? (lastRecon.status as any) : null,
    lastReconciliationAt: lastRecon ? lastRecon.completedAt?.toISOString() || null : null,
  };

  // 5. Recent Invoices
  const invoicesRes = await client
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.organizationId, organizationId))
    .orderBy(desc(billingInvoices.createdAt))
    .limit(10);

  const invoiceDtos: BillingInvoiceDto[] = invoicesRes.map((inv) => ({
    id: inv.id,
    stripeInvoiceId: inv.stripeInvoiceId,
    status: inv.status as any,
    currency: inv.currency,
    amountDue: inv.amountDue,
    amountPaid: inv.amountPaid,
    periodStart: inv.periodStart.toISOString(),
    periodEnd: inv.periodEnd.toISOString(),
    hostedInvoiceUrl: inv.hostedInvoiceUrl,
    invoicePdfUrl: inv.invoicePdfUrl,
    paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
    createdAt: inv.createdAt.toISOString(),
  }));

  return {
    organizationId: org.id,
    organizationName: org.name,
    isOwner,
    isTestMode: true, // M5 runs strictly in test mode
    customer: customerDto,
    subscription: subscriptionDto,
    usage: usageDto,
    invoices: invoiceDtos,
  };
}
