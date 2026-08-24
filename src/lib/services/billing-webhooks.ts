import "server-only";
import { eq, sql } from "drizzle-orm";
import { db, DbClient } from "@/db";
import {
  billingWebhookEvents,
  billingCheckoutSessions,
  billingSubscriptions,
  billingInvoices,
  billingCustomers,
  BillingWebhookEvent,
} from "@/db/schema";
import { getStripeClient } from "@/lib/stripe/client";
import { getValidatedStripeConfig } from "@/lib/stripe/safety";
import { SUPPORTED_WEBHOOK_EVENTS, SupportedWebhookEventType } from "@/lib/stripe/config";
import Stripe from "stripe";

function isSupportedEventType(type: string): type is SupportedWebhookEventType {
  return (SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(type);
}

/**
 * Verifies raw Stripe webhook signature, asserts test-mode, and durably records
 * minimal event metadata into the durable inbox table.
 */
export async function verifyAndRecordWebhookEvent(
  rawBody: string,
  signature: string,
  client: DbClient = db
): Promise<{ accepted: boolean; eventId: string; eventType: string }> {
  if (!rawBody || typeof rawBody !== "string") {
    throw new Error("Missing or invalid raw webhook body.");
  }
  if (!signature || typeof signature !== "string") {
    throw new Error("Missing Stripe-Signature header.");
  }

  const config = getValidatedStripeConfig();
  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch {
    throw new Error("Invalid webhook signature or payload.");
  }

  if (event.livemode !== false) {
    throw new Error("Stripe Safety Invariant: Live-mode webhook events are strictly forbidden.");
  }

  const stripeObjectId =
    event.data.object && typeof (event.data.object as { id?: unknown }).id === "string"
      ? (event.data.object as { id: string }).id
      : null;

  const eventCreatedAt = new Date(event.created * 1000);

  // Idempotently insert into durable webhook inbox
  await client
    .insert(billingWebhookEvents)
    .values({
      id: event.id,
      eventType: event.type,
      stripeObjectId,
      eventCreatedAt,
      livemode: event.livemode,
      status: "pending",
      attemptCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: billingWebhookEvents.id });

  return {
    accepted: true,
    eventId: event.id,
    eventType: event.type,
  };
}

/**
 * Resolves the internal organization ID for a Stripe customer or metadata.
 */
async function resolveOrganizationId(
  metadataOrgId: string | undefined,
  stripeCustomerId: string | null,
  client: DbClient
): Promise<string | null> {
  if (metadataOrgId && typeof metadataOrgId === "string") {
    return metadataOrgId;
  }
  if (stripeCustomerId) {
    const [cust] = await client
      .select({ organizationId: billingCustomers.organizationId })
      .from(billingCustomers)
      .where(eq(billingCustomers.stripeCustomerId, stripeCustomerId))
      .limit(1);
    if (cust) return cust.organizationId;
  }
  return null;
}

/**
 * Processes a single verified webhook inbox record with strict event ordering guards.
 */
export async function processWebhookEventRecord(
  eventRecord: BillingWebhookEvent,
  client: DbClient = db
): Promise<void> {
  if (!isSupportedEventType(eventRecord.eventType)) {
    // Acknowledge unsupported but valid event types safely
    await client
      .update(billingWebhookEvents)
      .set({
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvents.id, eventRecord.id));
    return;
  }

  const stripe = getStripeClient();

  try {
    switch (eventRecord.eventType) {
      case "checkout.session.completed": {
        if (!eventRecord.stripeObjectId) break;
        const session = await stripe.checkout.sessions.retrieve(eventRecord.stripeObjectId);
        const attemptId = session.metadata?.attemptId;
        if (attemptId) {
          await client
            .update(billingCheckoutSessions)
            .set({
              status: "completed",
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(billingCheckoutSessions.id, attemptId));
        }
        break;
      }

      case "checkout.session.expired": {
        if (!eventRecord.stripeObjectId) break;
        const [chk] = await client
          .select()
          .from(billingCheckoutSessions)
          .where(eq(billingCheckoutSessions.stripeCheckoutSessionId, eventRecord.stripeObjectId))
          .limit(1);

        if (chk && chk.status !== "completed") {
          await client
            .update(billingCheckoutSessions)
            .set({
              status: "expired",
              updatedAt: new Date(),
            })
            .where(eq(billingCheckoutSessions.id, chk.id));
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        if (!eventRecord.stripeObjectId) break;
        const sub = await stripe.subscriptions.retrieve(eventRecord.stripeObjectId);
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const orgId = await resolveOrganizationId(
          sub.metadata?.organizationId,
          customerId,
          client
        );

        if (!orgId) {
          console.warn(`[Billing Webhook] Could not resolve orgId for subscription ${sub.id}`);
          break;
        }

        const priceId = sub.items.data[0]?.price?.id || "unknown";
        const rawSub = sub as any;
        const periodStart = rawSub.current_period_start
          ? new Date(rawSub.current_period_start * 1000)
          : new Date(sub.start_date * 1000);
        const periodEnd = rawSub.current_period_end
          ? new Date(rawSub.current_period_end * 1000)
          : new Date((sub.start_date + 30 * 86400) * 1000);

        const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;
        const meteringEnabledAt = new Date(sub.start_date * 1000);

        // Check event ordering against existing subscription projection
        const [existingSub] = await client
          .select()
          .from(billingSubscriptions)
          .where(eq(billingSubscriptions.stripeSubscriptionId, sub.id))
          .limit(1);

        if (
          existingSub &&
          existingSub.lastEventCreatedAt &&
          existingSub.lastEventCreatedAt > eventRecord.eventCreatedAt
        ) {
          // Stale out-of-order event, skip state overwrite
          break;
        }

        await client
          .insert(billingSubscriptions)
          .values({
            organizationId: orgId,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            status: sub.status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            canceledAt,
            meteringEnabledAt,
            lastEventCreatedAt: eventRecord.eventCreatedAt,
            lastEventId: eventRecord.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: billingSubscriptions.stripeSubscriptionId,
            set: {
              status: sub.status,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              canceledAt,
              lastEventCreatedAt: eventRecord.eventCreatedAt,
              lastEventId: eventRecord.id,
              updatedAt: new Date(),
            },
          });
        break;
      }

      case "invoice.created":
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.voided": {
        if (!eventRecord.stripeObjectId) break;
        const inv = await stripe.invoices.retrieve(eventRecord.stripeObjectId);
        const rawInv = inv as any;
        const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id || null;
        const subId = typeof rawInv.subscription === "string"
          ? rawInv.subscription
          : rawInv.subscription?.id || rawInv.lines?.data?.[0]?.subscription || null;

        const orgId = await resolveOrganizationId(
          (inv.metadata as any)?.organizationId,
          customerId,
          client
        );

        if (!orgId) {
          console.warn(`[Billing Webhook] Could not resolve orgId for invoice ${inv.id}`);
          break;
        }

        const periodStart = new Date(inv.period_start * 1000);
        const periodEnd = new Date(inv.period_end * 1000);
        const paidAt = (inv.status_transitions as any)?.paid_at
          ? new Date((inv.status_transitions as any).paid_at * 1000)
          : null;
        const voidedAt = (inv.status_transitions as any)?.voided_at
          ? new Date((inv.status_transitions as any).voided_at * 1000)
          : null;

        // Check event ordering against existing invoice projection
        const [existingInv] = await client
          .select()
          .from(billingInvoices)
          .where(eq(billingInvoices.stripeInvoiceId, inv.id))
          .limit(1);

        if (
          existingInv &&
          existingInv.lastEventCreatedAt &&
          existingInv.lastEventCreatedAt > eventRecord.eventCreatedAt
        ) {
          // Stale out-of-order event, skip state overwrite
          break;
        }

        await client
          .insert(billingInvoices)
          .values({
            organizationId: orgId,
            stripeInvoiceId: inv.id,
            stripeSubscriptionId: subId,
            status: inv.status || "draft",
            currency: inv.currency,
            amountDue: inv.amount_due ?? 0,
            amountPaid: inv.amount_paid ?? 0,
            periodStart,
            periodEnd,
            hostedInvoiceUrl: inv.hosted_invoice_url || null,
            invoicePdfUrl: inv.invoice_pdf || null,
            paidAt,
            voidedAt,
            lastEventCreatedAt: eventRecord.eventCreatedAt,
            lastEventId: eventRecord.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: billingInvoices.stripeInvoiceId,
            set: {
              status: inv.status || "draft",
              amountDue: inv.amount_due ?? 0,
              amountPaid: inv.amount_paid ?? 0,
              hostedInvoiceUrl: inv.hosted_invoice_url || null,
              invoicePdfUrl: inv.invoice_pdf || null,
              paidAt,
              voidedAt,
              lastEventCreatedAt: eventRecord.eventCreatedAt,
              lastEventId: eventRecord.id,
              updatedAt: new Date(),
            },
          });
        break;
      }
    }

    await client
      .update(billingWebhookEvents)
      .set({
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvents.id, eventRecord.id));
  } catch (err) {
    const errorCode = (err as Error).name || "process_error";
    await client
      .update(billingWebhookEvents)
      .set({
        status: "failed",
        attemptCount: sql`"attempt_count" + 1`,
        errorCode,
        updatedAt: new Date(),
      })
      .where(eq(billingWebhookEvents.id, eventRecord.id));

    throw err;
  }
}
