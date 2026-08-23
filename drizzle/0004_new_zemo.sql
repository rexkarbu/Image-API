CREATE TABLE "billing_checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"stripe_checkout_session_id" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_sessions_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "billing_checkout_sessions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "billing_checkout_sessions_status_check" CHECK ("status" = ANY (ARRAY['creating'::text, 'open'::text, 'completed'::text, 'expired'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"provisioning_idempotency_key" text NOT NULL,
	"provisioning_status" text DEFAULT 'pending' NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "billing_customers_provisioning_idempotency_key_unique" UNIQUE("provisioning_idempotency_key"),
	CONSTRAINT "billing_customers_status_check" CHECK ("provisioning_status" = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text])),
	CONSTRAINT "billing_customers_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"stripe_subscription_id" text,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"amount_due" integer DEFAULT 0 NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"last_event_created_at" timestamp with time zone,
	"last_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_invoices_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id"),
	CONSTRAINT "billing_invoices_status_check" CHECK ("status" = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'uncollectible'::text, 'void'::text])),
	CONSTRAINT "billing_invoices_amount_due_check" CHECK ("amount_due" >= 0),
	CONSTRAINT "billing_invoices_amount_paid_check" CHECK ("amount_paid" >= 0),
	CONSTRAINT "billing_invoices_period_check" CHECK ("period_end" >= "period_start")
);
--> statement-breakpoint
CREATE TABLE "billing_reconciliation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"local_eligible_units" integer NOT NULL,
	"batched_units" integer NOT NULL,
	"reported_units" integer NOT NULL,
	"stripe_aggregated_units" integer NOT NULL,
	"difference" integer NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reconciliation_runs_status_check" CHECK ("status" = ANY (ARRAY['pending_provider'::text, 'matched'::text, 'mismatch'::text, 'failed'::text])),
	CONSTRAINT "billing_reconciliation_runs_period_check" CHECK ("period_end" > "period_start"),
	CONSTRAINT "billing_reconciliation_runs_counts_check" CHECK ("local_eligible_units" >= 0 AND "batched_units" >= 0 AND "reported_units" >= 0 AND "stripe_aggregated_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"metering_enabled_at" timestamp with time zone NOT NULL,
	"last_event_created_at" timestamp with time zone,
	"last_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "billing_subscriptions_status_check" CHECK ("status" = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'paused'::text, 'unpaid'::text, 'canceled'::text, 'incomplete'::text, 'incomplete_expired'::text])),
	CONSTRAINT "billing_subscriptions_period_check" CHECK ("current_period_end" > "current_period_start")
);
--> statement-breakpoint
CREATE TABLE "billing_usage_batch_items" (
	"batch_id" text NOT NULL,
	"usage_event_id" text NOT NULL,
	"organization_id" text NOT NULL,
	CONSTRAINT "billing_usage_batch_items_batch_id_usage_event_id_pk" PRIMARY KEY("batch_id","usage_event_id"),
	CONSTRAINT "billing_usage_batch_items_usage_event_id_unique" UNIQUE("usage_event_id")
);
--> statement-breakpoint
CREATE TABLE "billing_usage_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"units" integer NOT NULL,
	"meter_event_identifier" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"reported_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_usage_batches_meter_event_identifier_unique" UNIQUE("meter_event_identifier"),
	CONSTRAINT "billing_usage_batches_status_check" CHECK ("status" = ANY (ARRAY['pending'::text, 'processing'::text, 'reported'::text, 'failed'::text, 'manual_review'::text])),
	CONSTRAINT "billing_usage_batches_units_check" CHECK ("units" > 0),
	CONSTRAINT "billing_usage_batches_window_check" CHECK ("window_end" > "window_start"),
	CONSTRAINT "billing_usage_batches_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"stripe_object_id" text,
	"event_created_at" timestamp with time zone NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_webhook_events_status_check" CHECK ("status" = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text])),
	CONSTRAINT "billing_webhook_events_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_worker_leases" (
	"worker_name" text PRIMARY KEY NOT NULL,
	"lease_token" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_worker_leases_lease_token_unique" UNIQUE("lease_token")
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD CONSTRAINT "billing_checkout_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD CONSTRAINT "billing_checkout_sessions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reconciliation_runs" ADD CONSTRAINT "billing_reconciliation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_batch_items" ADD CONSTRAINT "billing_usage_batch_items_batch_id_billing_usage_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."billing_usage_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_batch_items" ADD CONSTRAINT "billing_usage_batch_items_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_usage_batches" ADD CONSTRAINT "billing_usage_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_sessions_active_org_idx" ON "billing_checkout_sessions" USING btree ("organization_id") WHERE "status" IN ('creating'::text, 'open'::text);--> statement-breakpoint
CREATE INDEX "billing_checkout_sessions_org_idx" ON "billing_checkout_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_customers_retry_idx" ON "billing_customers" USING btree ("provisioning_status","next_retry_at");--> statement-breakpoint
CREATE INDEX "billing_customers_stripe_cust_idx" ON "billing_customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "billing_invoices_org_created_idx" ON "billing_invoices" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_invoices_stripe_inv_idx" ON "billing_invoices" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_runs_org_idx" ON "billing_reconciliation_runs" USING btree ("organization_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_org_active_idx" ON "billing_subscriptions" USING btree ("organization_id") WHERE "status" NOT IN ('canceled'::text, 'incomplete_expired'::text);--> statement-breakpoint
CREATE INDEX "billing_subscriptions_org_idx" ON "billing_subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_stripe_sub_idx" ON "billing_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_usage_batch_items_batch_idx" ON "billing_usage_batch_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "billing_usage_batch_items_org_idx" ON "billing_usage_batch_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "billing_usage_batches_org_window_idx" ON "billing_usage_batches" USING btree ("organization_id","window_start","window_end");--> statement-breakpoint
CREATE INDEX "billing_usage_batches_status_retry_idx" ON "billing_usage_batches" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "billing_webhook_events_status_retry_idx" ON "billing_webhook_events" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "billing_webhook_events_created_idx" ON "billing_webhook_events" USING btree ("created_at");--> statement-breakpoint
INSERT INTO "billing_customers" ("organization_id", "provisioning_idempotency_key", "provisioning_status", "livemode", "created_at", "updated_at")
SELECT "id", gen_random_uuid()::text, 'pending', false, now(), now()
FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;