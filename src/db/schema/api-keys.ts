import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { user } from "./auth";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
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
    index("api_keys_active_lookup_idx").on(table.keyHash, table.status),
    index("api_keys_created_by_idx").on(table.createdByUserId),
  ]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
