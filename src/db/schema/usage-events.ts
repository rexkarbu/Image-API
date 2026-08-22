import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { apiKeys } from "./api-keys";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    endpoint: text("endpoint").notNull(),
    units: integer("units").notNull(),
    statusCode: integer("status_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("usage_events_units_positive", sql`${table.units} > 0`),
    index("usage_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("usage_events_key_created_idx").on(table.apiKeyId, table.createdAt),
  ]
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
