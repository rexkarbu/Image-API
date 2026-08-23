ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_units_positive";--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "units" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "status_code" SET DEFAULT 200;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_request_id_format" CHECK ("request_id" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_units_equals_one" CHECK ("units" = 1);--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_status_code_2xx" CHECK ("status_code" >= 200 AND "status_code" <= 299);