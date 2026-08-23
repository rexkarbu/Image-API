import { pgTable, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { user } from "./auth";
import crypto from "node:crypto";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    createdByUserId: text("created_by_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").notNull().default("image:transform"),
    status: text("status").notNull().default("active"), // 'active' | 'revoked'
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_keys_org_id_idx").on(table.organizationId),
    index("api_keys_org_status_idx").on(table.organizationId, table.status),
    index("api_keys_active_lookup_idx").on(table.keyHash, table.status),
    index("api_keys_created_by_idx").on(table.createdByUserId),
    check("api_keys_status_check", sql`"status" IN ('active', 'revoked')`),
    check("api_keys_key_hash_format", sql`"key_hash" ~ '^[0-9a-f]{64}$'`),
    check("api_keys_key_prefix_format", sql`"key_prefix" ~ '^img_live_[A-Za-z0-9_-]{8}$'`),
    check(
      "api_keys_status_revoked_consistency",
      sql`("status" = 'active' AND "revoked_at" IS NULL) OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)`
    ),
    check("api_keys_scopes_check", sql`"scopes" = 'image:transform'`),
    check(
      "api_keys_expires_at_check",
      sql`"expires_at" IS NULL OR "expires_at" > "created_at"`
    ),
  ]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export const apiKeyAuditEvents = pgTable(
  "api_key_audit_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    relatedApiKeyId: text("related_api_key_id")
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id")
      .references(() => user.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(), // 'created' | 'revoked' | 'rotation_created' | 'expiration_scheduled'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("api_key_audit_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("api_key_audit_events_key_created_idx").on(table.apiKeyId, table.createdAt),
    uniqueIndex("api_key_audit_events_key_revoked_idx")
      .on(table.apiKeyId)
      .where(sql`"event_type" = 'revoked'`),
    uniqueIndex("api_key_audit_events_related_rotation_idx")
      .on(table.relatedApiKeyId)
      .where(sql`"event_type" = 'rotation_created'`),
    check(
      "api_key_audit_events_type_check",
      sql`"event_type" IN ('created', 'revoked', 'rotation_created', 'expiration_scheduled')`
    ),
  ]
);

export type ApiKeyAuditEvent = typeof apiKeyAuditEvents.$inferSelect;
export type NewApiKeyAuditEvent = typeof apiKeyAuditEvents.$inferInsert;
