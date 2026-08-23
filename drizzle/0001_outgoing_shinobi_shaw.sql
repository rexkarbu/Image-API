CREATE TABLE "api_key_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"related_api_key_id" text,
	"actor_user_id" text,
	"event_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_audit_events_type_check" CHECK ("event_type" IN ('created', 'revoked', 'rotation_created', 'expiration_scheduled'))
);
--> statement-breakpoint
ALTER TABLE "api_key_audit_events" ADD CONSTRAINT "api_key_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_audit_events" ADD CONSTRAINT "api_key_audit_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_audit_events" ADD CONSTRAINT "api_key_audit_events_related_api_key_id_api_keys_id_fk" FOREIGN KEY ("related_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_audit_events" ADD CONSTRAINT "api_key_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_audit_events_org_created_idx" ON "api_key_audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "api_key_audit_events_key_created_idx" ON "api_key_audit_events" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "api_keys_org_status_idx" ON "api_keys" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_status_check" CHECK ("status" IN ('active', 'revoked'));--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_length" CHECK (length("key_hash") = 64);--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_prefix_check" CHECK ("key_prefix" LIKE 'img_live_%');--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_at_check" CHECK (("status" = 'revoked' AND "revoked_at" IS NOT NULL) OR ("status" = 'active'));--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_expires_at_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at");