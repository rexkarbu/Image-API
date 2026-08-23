ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_key_hash_length";--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_key_prefix_check";--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_revoked_at_check";--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_audit_events_key_revoked_idx" ON "api_key_audit_events" USING btree ("api_key_id") WHERE "event_type" = 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_audit_events_related_rotation_idx" ON "api_key_audit_events" USING btree ("related_api_key_id") WHERE "event_type" = 'rotation_created';--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_hash_format" CHECK ("key_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_key_prefix_format" CHECK ("key_prefix" ~ '^img_live_[A-Za-z0-9_-]{8}$');--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_status_revoked_consistency" CHECK (("status" = 'active' AND "revoked_at" IS NULL) OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_scopes_check" CHECK ("scopes" = 'image:transform');