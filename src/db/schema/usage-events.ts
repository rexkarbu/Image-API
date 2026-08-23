import { pgTable, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { apiKeys } from "./api-keys";
import crypto from "node:crypto";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    requestId: text("request_id").notNull().unique(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "restrict" }),
    endpoint: text("endpoint").notNull(),
    units: integer("units").notNull().default(1),
    statusCode: integer("status_code").notNull().default(200),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("usage_events_request_id_format", sql`"request_id" ~ '^[0-9a-f]{64}$'`),
    check("usage_events_units_equals_one", sql`"units" = 1`),
    check("usage_events_status_code_2xx", sql`"status_code" >= 200 AND "status_code" <= 299`),
    index("usage_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("usage_events_key_created_idx").on(table.apiKeyId, table.createdAt),
  ]
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
