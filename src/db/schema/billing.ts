import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { user } from "./auth";
import { usageEvents } from "./usage-events";
import crypto from "node:crypto";

// 1. billing_customers
export const billingCustomers = pgTable(
  "billing_customers",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id").unique(),
    provisioningIdempotencyKey: text("provisioning_idempotency_key")
      .notNull()
      .unique()
      .$defaultFn(() => crypto.randomUUID()),
    provisioningStatus: text("provisioning_status").notNull().default("pending"),
    livemode: boolean("livemode").notNull().default(false),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_customers_status_check",
      sql`"provisioning_status" = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])`
    ),
    check("billing_customers_attempt_count_check", sql`"attempt_count" >= 0`),
    index("billing_customers_retry_idx").on(table.provisioningStatus, table.nextRetryAt),
    index("billing_customers_stripe_cust_idx").on(table.stripeCustomerId),
  ]
);

// 2. billing_subscriptions
export const billingSubscriptions = pgTable(
  "billing_subscriptions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripePriceId: text("stripe_price_id").notNull(),
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    meteringEnabledAt: timestamp("metering_enabled_at", { withTimezone: true }).notNull(),
    lastEventCreatedAt: timestamp("last_event_created_at", { withTimezone: true }),
    lastEventId: text("last_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_subscriptions_status_check",
      sql`"status" = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'paused'::text, 'unpaid'::text, 'canceled'::text, 'incomplete'::text, 'incomplete_expired'::text])`
    ),
    check(
      "billing_subscriptions_period_check",
      sql`"current_period_end" > "current_period_start"`
    ),
    uniqueIndex("billing_subscriptions_org_active_idx")
      .on(table.organizationId)
      .where(
        sql`"status" NOT IN ('canceled'::text, 'incomplete_expired'::text)`
      ),
    index("billing_subscriptions_org_idx").on(table.organizationId),
    index("billing_subscriptions_stripe_sub_idx").on(table.stripeSubscriptionId),
  ]
);

// 3. billing_checkout_sessions
export const billingCheckoutSessions = pgTable(
  "billing_checkout_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("creating"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_checkout_sessions_status_check",
      sql`"status" = ANY (ARRAY['creating'::text, 'open'::text, 'completed'::text, 'expired'::text, 'failed'::text])`
    ),
    uniqueIndex("billing_checkout_sessions_active_org_idx")
      .on(table.organizationId)
      .where(sql`"status" IN ('creating'::text, 'open'::text)`),
    index("billing_checkout_sessions_org_idx").on(table.organizationId),
  ]
);

// 4. billing_webhook_events
export const billingWebhookEvents = pgTable(
  "billing_webhook_events",
  {
    id: text("id").primaryKey(), // Stripe Event ID evt_...
    eventType: text("event_type").notNull(),
    stripeObjectId: text("stripe_object_id"),
    eventCreatedAt: timestamp("event_created_at", { withTimezone: true }).notNull(),
    livemode: boolean("livemode").notNull().default(false),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_webhook_events_status_check",
      sql`"status" = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text])`
    ),
    check("billing_webhook_events_attempt_count_check", sql`"attempt_count" >= 0`),
    index("billing_webhook_events_status_retry_idx").on(table.status, table.nextRetryAt),
    index("billing_webhook_events_created_idx").on(table.createdAt),
  ]
);

// 5. billing_usage_batches
export const billingUsageBatches = pgTable(
  "billing_usage_batches",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    units: integer("units").notNull(),
    meterEventIdentifier: text("meter_event_identifier").notNull().unique(),
    status: text("status").notNull().default("pending"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_usage_batches_status_check",
      sql`"status" = ANY (ARRAY['pending'::text, 'processing'::text, 'reported'::text, 'failed'::text, 'manual_review'::text])`
    ),
    check("billing_usage_batches_units_check", sql`"units" > 0`),
    check("billing_usage_batches_window_check", sql`"window_end" > "window_start"`),
    check("billing_usage_batches_attempt_count_check", sql`"attempt_count" >= 0`),
    index("billing_usage_batches_org_window_idx").on(
      table.organizationId,
      table.windowStart,
      table.windowEnd
    ),
    index("billing_usage_batches_status_retry_idx").on(table.status, table.nextRetryAt),
  ]
);

// 6. billing_usage_batch_items
export const billingUsageBatchItems = pgTable(
  "billing_usage_batch_items",
  {
    batchId: text("batch_id")
      .notNull()
      .references(() => billingUsageBatches.id, { onDelete: "restrict" }),
    usageEventId: text("usage_event_id")
      .notNull()
      .unique()
      .references(() => usageEvents.id, { onDelete: "restrict" }),
    organizationId: text("organization_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.usageEventId] }),
    index("billing_usage_batch_items_batch_idx").on(table.batchId),
    index("billing_usage_batch_items_org_idx").on(table.organizationId),
  ]
);

// 7. billing_invoices
export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull().unique(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull(),
    currency: text("currency").notNull(),
    amountDue: integer("amount_due").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    lastEventCreatedAt: timestamp("last_event_created_at", { withTimezone: true }),
    lastEventId: text("last_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_invoices_status_check",
      sql`"status" = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'uncollectible'::text, 'void'::text])`
    ),
    check("billing_invoices_amount_due_check", sql`"amount_due" >= 0`),
    check("billing_invoices_amount_paid_check", sql`"amount_paid" >= 0`),
    check("billing_invoices_period_check", sql`"period_end" >= "period_start"`),
    index("billing_invoices_org_created_idx").on(table.organizationId, table.createdAt),
    index("billing_invoices_stripe_inv_idx").on(table.stripeInvoiceId),
  ]
);

// 8. billing_reconciliation_runs
export const billingReconciliationRuns = pgTable(
  "billing_reconciliation_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    localEligibleUnits: integer("local_eligible_units").notNull(),
    batchedUnits: integer("batched_units").notNull(),
    reportedUnits: integer("reported_units").notNull(),
    stripeAggregatedUnits: integer("stripe_aggregated_units").notNull(),
    difference: integer("difference").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "billing_reconciliation_runs_status_check",
      sql`"status" = ANY (ARRAY['pending_provider'::text, 'matched'::text, 'mismatch'::text, 'failed'::text])`
    ),
    check("billing_reconciliation_runs_period_check", sql`"period_end" > "period_start"`),
    check(
      "billing_reconciliation_runs_counts_check",
      sql`"local_eligible_units" >= 0 AND "batched_units" >= 0 AND "reported_units" >= 0 AND "stripe_aggregated_units" >= 0`
    ),
    index("billing_reconciliation_runs_org_idx").on(
      table.organizationId,
      table.periodStart,
      table.periodEnd
    ),
  ]
);

// 9. billing_worker_leases
export const billingWorkerLeases = pgTable("billing_worker_leases", {
  workerName: text("worker_name").primaryKey(),
  leaseToken: text("lease_token").notNull().unique(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Infer Types
export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type NewBillingCustomer = typeof billingCustomers.$inferInsert;

export type BillingSubscription = typeof billingSubscriptions.$inferSelect;
export type NewBillingSubscription = typeof billingSubscriptions.$inferInsert;

export type BillingCheckoutSession = typeof billingCheckoutSessions.$inferSelect;
export type NewBillingCheckoutSession = typeof billingCheckoutSessions.$inferInsert;

export type BillingWebhookEvent = typeof billingWebhookEvents.$inferSelect;
export type NewBillingWebhookEvent = typeof billingWebhookEvents.$inferInsert;

export type BillingUsageBatch = typeof billingUsageBatches.$inferSelect;
export type NewBillingUsageBatch = typeof billingUsageBatches.$inferInsert;

export type BillingUsageBatchItem = typeof billingUsageBatchItems.$inferSelect;
export type NewBillingUsageBatchItem = typeof billingUsageBatchItems.$inferInsert;

export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type NewBillingInvoice = typeof billingInvoices.$inferInsert;

export type BillingReconciliationRun = typeof billingReconciliationRuns.$inferSelect;
export type NewBillingReconciliationRun = typeof billingReconciliationRuns.$inferInsert;

export type BillingWorkerLease = typeof billingWorkerLeases.$inferSelect;
export type NewBillingWorkerLease = typeof billingWorkerLeases.$inferInsert;
