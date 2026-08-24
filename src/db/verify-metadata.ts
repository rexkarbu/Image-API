import { Pool } from "pg";
import * as dotenv from "dotenv";
import { assertDevelopmentDatabaseSafety } from "./development-safety";
import { validatePostgresUrlSecurity } from "./ssl-validation";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export interface CheckConstraintRule {
  table: string;
  name: string;
  validate: (normalizedClause: string) => boolean;
  description: string;
}

/**
 * Normalizes PostgreSQL check clause strings by stripping typecasts (::type),
 * replacing parentheses with spaces to form clean token boundaries, and collapsing whitespace.
 */
export function normalizeCheckClause(clause: string): string {
  return clause
    .replace(/::[a-z0-9_]+/gi, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts all single-quoted string literals from a normalized clause.
 */
function extractQuotedLiterals(clause: string): string[] {
  return Array.from(clause.matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

function validateEnumCheck(clause: string, expectedEnums: string[]): boolean {
  const m = clause.match(/^\s*[a-z0-9_]+\s*(?:=\s*ANY\s*ARRAY\s*\[\s*(.*?)\s*\]|IN\s*\[?\s*(.*?)\s*\]?)\s*$/i);
  if (!m) return false;
  const inner = m[1] || m[2] || "";
  const nonLiteral = inner.replace(/'[^']*'/g, "").replace(/[\s,]/g, "");
  if (nonLiteral.length > 0) return false;
  const expected = [...expectedEnums].sort();
  const actual = extractQuotedLiterals(inner).sort();
  return expected.length === actual.length && expected.every((val, idx) => val === actual[idx]);
}

export const REQUIRED_CHECK_CONSTRAINTS: CheckConstraintRule[] = [
  {
    table: "usage_events",
    name: "usage_events_units_equals_one",
    validate: (c) => /^\s*units\s*=\s*1\s*$/i.test(c),
    description: "units = 1",
  },
  {
    table: "usage_events",
    name: "usage_events_request_id_format",
    validate: (c) => /^\s*request_id\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*$/i.test(c),
    description: "request_id ~ '^[0-9a-f]{64}$'",
  },
  {
    table: "usage_events",
    name: "usage_events_status_code_2xx",
    validate: (c) =>
      /^\s*(?:status_code\s*>=\s*200\s+AND\s+status_code\s*<=\s*299|status_code\s*<=\s*299\s+AND\s+status_code\s*>=\s*200)\s*$/i.test(
        c
      ),
    description: "status_code >= 200 AND status_code <= 299",
  },
  {
    table: "api_key_audit_events",
    name: "api_key_audit_events_type_check",
    validate: (c) =>
      validateEnumCheck(c, ["created", "expiration_scheduled", "revoked", "rotation_created"]),
    description: "event_type IN ('created', 'revoked', 'rotation_created', 'expiration_scheduled')",
  },
  {
    table: "api_keys",
    name: "api_keys_status_check",
    validate: (c) => validateEnumCheck(c, ["active", "revoked"]),
    description: "status IN ('active', 'revoked')",
  },
  {
    table: "api_keys",
    name: "api_keys_key_hash_format",
    validate: (c) => /^\s*key_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*$/i.test(c),
    description: "key_hash ~ '^[0-9a-f]{64}$'",
  },
  {
    table: "api_keys",
    name: "api_keys_key_prefix_format",
    validate: (c) => /^\s*key_prefix\s*~\s*'\^img_live_\[A-Za-z0-9_-\]\{8\}\$'\s*$/i.test(c),
    description: "key_prefix ~ '^img_live_[A-Za-z0-9_-]{8}$'",
  },
  {
    table: "api_keys",
    name: "api_keys_status_revoked_consistency",
    validate: (c) => {
      const branchActive = `(?:status\\s*=\\s*'active'\\s+AND\\s+revoked_at\\s+IS\\s+NULL|revoked_at\\s+IS\\s+NULL\\s+AND\\s+status\\s*=\\s*'active')`;
      const branchRevoked = `(?:status\\s*=\\s*'revoked'\\s+AND\\s+revoked_at\\s+IS\\s+NOT\\s+NULL|revoked_at\\s+IS\\s+NOT\\s+NULL\\s+AND\\s+status\\s*=\\s*'revoked')`;
      const full = new RegExp(
        `^\\s*(?:${branchActive}\\s+OR\\s+${branchRevoked}|${branchRevoked}\\s+OR\\s+${branchActive})\\s*$`,
        "i"
      );
      return full.test(c);
    },
    description: "(status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL)",
  },
  {
    table: "api_keys",
    name: "api_keys_scopes_check",
    validate: (c) => /^\s*scopes\s*=\s*'image:transform'\s*$/i.test(c),
    description: "scopes = 'image:transform'",
  },
  {
    table: "api_keys",
    name: "api_keys_expires_at_check",
    validate: (c) =>
      /^\s*(?:expires_at\s+IS\s+NULL\s+OR\s+expires_at\s*>\s*created_at|expires_at\s*>\s*created_at\s+OR\s+expires_at\s+IS\s+NULL)\s*$/i.test(
        c
      ),
    description: "expires_at IS NULL OR expires_at > created_at",
  },
  // Billing tables check constraints
  {
    table: "billing_checkout_sessions",
    name: "billing_checkout_sessions_status_check",
    validate: (c) => validateEnumCheck(c, ["creating", "open", "completed", "expired", "failed"]),
    description: "status IN ('creating', 'open', 'completed', 'expired', 'failed')",
  },
  {
    table: "billing_customers",
    name: "billing_customers_status_check",
    validate: (c) => validateEnumCheck(c, ["pending", "ready", "failed"]),
    description: "provisioning_status IN ('pending', 'ready', 'failed')",
  },
  {
    table: "billing_customers",
    name: "billing_customers_attempt_count_check",
    validate: (c) => /^\s*attempt_count\s*>=\s*0\s*$/i.test(c),
    description: "attempt_count >= 0",
  },
  {
    table: "billing_invoices",
    name: "billing_invoices_status_check",
    validate: (c) => validateEnumCheck(c, ["draft", "open", "paid", "uncollectible", "void"]),
    description: "status IN ('draft', 'open', 'paid', 'uncollectible', 'void')",
  },
  {
    table: "billing_invoices",
    name: "billing_invoices_amount_due_check",
    validate: (c) => /^\s*amount_due\s*>=\s*0\s*$/i.test(c),
    description: "amount_due >= 0",
  },
  {
    table: "billing_invoices",
    name: "billing_invoices_amount_paid_check",
    validate: (c) => /^\s*amount_paid\s*>=\s*0\s*$/i.test(c),
    description: "amount_paid >= 0",
  },
  {
    table: "billing_invoices",
    name: "billing_invoices_period_check",
    validate: (c) => /^\s*period_end\s*>=\s*period_start\s*$/i.test(c),
    description: "period_end >= period_start",
  },
  {
    table: "billing_reconciliation_runs",
    name: "billing_reconciliation_runs_status_check",
    validate: (c) => validateEnumCheck(c, ["pending_provider", "matched", "mismatch", "failed"]),
    description: "status IN ('pending_provider', 'matched', 'mismatch', 'failed')",
  },
  {
    table: "billing_reconciliation_runs",
    name: "billing_reconciliation_runs_period_check",
    validate: (c) => /^\s*period_end\s*>\s*period_start\s*$/i.test(c),
    description: "period_end > period_start",
  },
  {
    table: "billing_reconciliation_runs",
    name: "billing_reconciliation_runs_counts_check",
    validate: (c) =>
      /local_eligible_units\s*>=\s*0/i.test(c) &&
      /batched_units\s*>=\s*0/i.test(c) &&
      /reported_units\s*>=\s*0/i.test(c) &&
      /stripe_aggregated_units\s*>=\s*0/i.test(c),
    description:
      "local_eligible_units >= 0 AND batched_units >= 0 AND reported_units >= 0 AND stripe_aggregated_units >= 0",
  },
  {
    table: "billing_subscriptions",
    name: "billing_subscriptions_status_check",
    validate: (c) =>
      validateEnumCheck(c, [
        "trialing",
        "active",
        "past_due",
        "paused",
        "unpaid",
        "canceled",
        "incomplete",
        "incomplete_expired",
      ]),
    description:
      "status IN ('trialing', 'active', 'past_due', 'paused', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired')",
  },
  {
    table: "billing_subscriptions",
    name: "billing_subscriptions_period_check",
    validate: (c) => /^\s*current_period_end\s*>\s*current_period_start\s*$/i.test(c),
    description: "current_period_end > current_period_start",
  },
  {
    table: "billing_usage_batches",
    name: "billing_usage_batches_status_check",
    validate: (c) =>
      validateEnumCheck(c, ["pending", "processing", "reported", "failed", "manual_review"]),
    description: "status IN ('pending', 'processing', 'reported', 'failed', 'manual_review')",
  },
  {
    table: "billing_usage_batches",
    name: "billing_usage_batches_units_check",
    validate: (c) => /^\s*units\s*>\s*0\s*$/i.test(c),
    description: "units > 0",
  },
  {
    table: "billing_usage_batches",
    name: "billing_usage_batches_window_check",
    validate: (c) => /^\s*window_end\s*>\s*window_start\s*$/i.test(c),
    description: "window_end > window_start",
  },
  {
    table: "billing_usage_batches",
    name: "billing_usage_batches_attempt_count_check",
    validate: (c) => /^\s*attempt_count\s*>=\s*0\s*$/i.test(c),
    description: "attempt_count >= 0",
  },
  {
    table: "billing_webhook_events",
    name: "billing_webhook_events_status_check",
    validate: (c) => validateEnumCheck(c, ["pending", "processing", "processed", "failed"]),
    description: "status IN ('pending', 'processing', 'processed', 'failed')",
  },
  {
    table: "billing_webhook_events",
    name: "billing_webhook_events_attempt_count_check",
    validate: (c) => /^\s*attempt_count\s*>=\s*0\s*$/i.test(c),
    description: "attempt_count >= 0",
  },
];

export function assertCheckConstraints(
  rules: CheckConstraintRule[],
  actualRows: { table_name: string; constraint_name: string; check_clause: string }[]
) {
  for (const check of rules) {
    const match = actualRows.find(
      (r) => r.table_name === check.table && r.constraint_name === check.name
    );
    if (!match) {
      throw new Error(
        `Metadata Assertion Failed: Missing exact check constraint '${check.name}' on table '${check.table}'.`
      );
    }
    const normalized = normalizeCheckClause(match.check_clause);
    if (!check.validate(normalized)) {
      throw new Error(
        `Metadata Assertion Failed: Check constraint '${check.name}' failed semantic validation. Expected '${check.description}', got '${match.check_clause}'`
      );
    }
  }
}

const EXPECTED_TABLES = [
  "account",
  "api_key_audit_events",
  "api_keys",
  "billing_checkout_sessions",
  "billing_customers",
  "billing_invoices",
  "billing_reconciliation_runs",
  "billing_subscriptions",
  "billing_usage_batch_items",
  "billing_usage_batches",
  "billing_webhook_events",
  "billing_worker_leases",
  "organization_members",
  "organizations",
  "session",
  "usage_events",
  "user",
  "verification",
];

const EXPECTED_FOREIGN_KEYS = [
  { table: "account", column: "user_id", foreignTable: "user", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "session", column: "user_id", foreignTable: "user", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "organization_members", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "organization_members", column: "user_id", foreignTable: "user", foreignColumn: "id", deleteRule: "CASCADE" },
  { table: "api_keys", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "api_keys", column: "created_by_user_id", foreignTable: "user", foreignColumn: "id", deleteRule: "SET NULL" },
  { table: "usage_events", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "usage_events", column: "api_key_id", foreignTable: "api_keys", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "api_key_audit_events", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "api_key_audit_events", column: "api_key_id", foreignTable: "api_keys", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "api_key_audit_events", column: "related_api_key_id", foreignTable: "api_keys", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "api_key_audit_events", column: "actor_user_id", foreignTable: "user", foreignColumn: "id", deleteRule: "SET NULL" },
  // Billing foreign keys
  { table: "billing_checkout_sessions", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_checkout_sessions", column: "actor_user_id", foreignTable: "user", foreignColumn: "id", deleteRule: "SET NULL" },
  { table: "billing_customers", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_invoices", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_reconciliation_runs", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_subscriptions", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_usage_batch_items", column: "batch_id", foreignTable: "billing_usage_batches", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_usage_batch_items", column: "usage_event_id", foreignTable: "usage_events", foreignColumn: "id", deleteRule: "RESTRICT" },
  { table: "billing_usage_batches", column: "organization_id", foreignTable: "organizations", foreignColumn: "id", deleteRule: "RESTRICT" },
];

const EXPECTED_UNIQUE = [
  { table: "api_keys", column: "key_hash", name: "api_keys_key_hash_unique" },
  { table: "session", column: "token", name: "session_token_unique" },
  { table: "usage_events", column: "request_id", name: "usage_events_request_id_unique" },
  { table: "user", column: "email", name: "user_email_unique" },
  // Billing unique constraints
  { table: "billing_checkout_sessions", column: "stripe_checkout_session_id", name: "billing_checkout_sessions_stripe_checkout_session_id_unique" },
  { table: "billing_checkout_sessions", column: "idempotency_key", name: "billing_checkout_sessions_idempotency_key_unique" },
  { table: "billing_customers", column: "stripe_customer_id", name: "billing_customers_stripe_customer_id_unique" },
  { table: "billing_customers", column: "provisioning_idempotency_key", name: "billing_customers_provisioning_idempotency_key_unique" },
  { table: "billing_invoices", column: "stripe_invoice_id", name: "billing_invoices_stripe_invoice_id_unique" },
  { table: "billing_subscriptions", column: "stripe_subscription_id", name: "billing_subscriptions_stripe_subscription_id_unique" },
  { table: "billing_usage_batch_items", column: "usage_event_id", name: "billing_usage_batch_items_usage_event_id_unique" },
  { table: "billing_usage_batches", column: "meter_event_identifier", name: "billing_usage_batches_meter_event_identifier_unique" },
  { table: "billing_worker_leases", column: "lease_token", name: "billing_worker_leases_lease_token_unique" },
];

const EXPECTED_INDEXES = [
  "org_members_user_id_idx",
  "org_members_org_id_idx",
  "api_keys_org_id_idx",
  "api_keys_org_status_idx",
  "api_keys_active_lookup_idx",
  "api_keys_created_by_idx",
  "api_key_audit_events_org_created_idx",
  "api_key_audit_events_key_created_idx",
  "api_key_audit_events_key_revoked_idx",
  "api_key_audit_events_related_rotation_idx",
  "usage_events_org_created_idx",
  "usage_events_key_created_idx",
  // Billing indexes
  "billing_checkout_sessions_active_org_idx",
  "billing_checkout_sessions_org_idx",
  "billing_customers_retry_idx",
  "billing_customers_stripe_cust_idx",
  "billing_invoices_org_created_idx",
  "billing_invoices_stripe_inv_idx",
  "billing_reconciliation_runs_org_idx",
  "billing_subscriptions_org_active_idx",
  "billing_subscriptions_org_idx",
  "billing_subscriptions_stripe_sub_idx",
  "billing_usage_batch_items_batch_idx",
  "billing_usage_batch_items_org_idx",
  "billing_usage_batches_org_window_idx",
  "billing_usage_batches_status_retry_idx",
  "billing_webhook_events_status_retry_idx",
  "billing_webhook_events_created_idx",
];

export async function verifyDbMetadata() {
  if (process.env.DATABASE_ENV === "development") {
    assertDevelopmentDatabaseSafety();
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not defined in environment.");
  }
  validatePostgresUrlSecurity(connectionString, "DATABASE_URL");

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 25000,
  });

  let runError: Error | null = null;

  try {
    console.log("=== PostgreSQL Database Metadata Verification (Fail-Closed) ===");

    // 1. Table existence
    const tablesRes = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map((r) => r.table_name);
    console.log(`\n1. Tables in database: [${tables.join(", ")}]`);

    const missingTables = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Metadata Assertion Failed: Missing required tables: [${missingTables.join(", ")}]`);
    }
    console.log(`   ✅ All ${EXPECTED_TABLES.length} required application tables present.`);

    // 2. Foreign Key Delete Rules
    const fksRes = await pool.query<{
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }>(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name;
    `);

    console.log("\n2. Foreign Key Delete Rules:");
    for (const expected of EXPECTED_FOREIGN_KEYS) {
      const match = fksRes.rows.find(
        (r) =>
          r.table_name === expected.table &&
          r.column_name === expected.column &&
          r.foreign_table_name === expected.foreignTable &&
          r.foreign_column_name === expected.foreignColumn
      );

      if (!match) {
        throw new Error(
          `Metadata Assertion Failed: Missing FK from ${expected.table}.${expected.column} to ${expected.foreignTable}.${expected.foreignColumn}.`
        );
      }

      if (match.delete_rule !== expected.deleteRule) {
        throw new Error(
          `Security Invariant Violation: FK from ${expected.table}.${expected.column} to ${expected.foreignTable}.${expected.foreignColumn} has delete rule '${match.delete_rule}', expected '${expected.deleteRule}'.`
        );
      }

      console.log(
        `   - ${match.table_name}.${match.column_name} -> ${match.foreign_table_name}.${match.foreign_column_name} (ON DELETE ${match.delete_rule})`
      );
    }
    console.log(`   ✅ All ${EXPECTED_FOREIGN_KEYS.length} foreign key delete rules verified.`);

    // 3. Unique constraints
    const uniqueRes = await pool.query<{
      table_name: string;
      column_name: string;
      constraint_name: string;
    }>(`
      SELECT
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name;
    `);

    console.log("\n3. Unique Constraints:");
    for (const expected of EXPECTED_UNIQUE) {
      const match = uniqueRes.rows.find(
        (r) =>
          r.table_name === expected.table &&
          r.column_name === expected.column &&
          r.constraint_name === expected.name
      );
      if (!match) {
        throw new Error(
          `Metadata Assertion Failed: Missing unique constraint '${expected.name}' on ${expected.table}.${expected.column}.`
        );
      }
      console.log(`   - ${match.table_name}.${match.column_name} (${match.constraint_name})`);
    }
    console.log(`   ✅ All ${EXPECTED_UNIQUE.length} required unique constraints verified.`);

    // 4. Check Constraint assertions
    const checksRes = await pool.query<{
      table_name: string;
      constraint_name: string;
      check_clause: string;
    }>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        cc.check_clause
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.check_constraints AS cc
        ON tc.constraint_name = cc.constraint_name AND tc.constraint_schema = cc.constraint_schema
      WHERE tc.table_schema = 'public' AND tc.constraint_type = 'CHECK'
        AND tc.constraint_name NOT LIKE '%_not_null'
      ORDER BY tc.table_name;
    `);

    console.log("\n4. Check Constraints:");
    assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, checksRes.rows);
    for (const check of REQUIRED_CHECK_CONSTRAINTS) {
      const match = checksRes.rows.find((r) => r.table_name === check.table && r.constraint_name === check.name);
      if (match) {
        console.log(`   - ${match.table_name}: ${match.constraint_name} -> ${match.check_clause}`);
      }
    }
    console.log(`   ✅ All ${REQUIRED_CHECK_CONSTRAINTS.length} required check constraints verified.`);

    // 5. Plaintext API key check
    const columnsRes = await pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name IN ('api_keys', 'api_key_audit_events') AND table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    console.log("\n5. Column Audit for Plaintext Key Exposure:");
    for (const col of columnsRes.rows) {
      const isSuspicious = ["key", "api_key", "secret", "token", "plaintext"].includes(
        col.column_name.toLowerCase()
      );
      if (isSuspicious) {
        throw new Error(
          `Metadata Assertion Failed: Plaintext key column '${col.column_name}' detected in table ${col.table_name}!`
        );
      }
    }
    console.log("   ✅ Zero plaintext key columns detected in api_keys and api_key_audit_events.");

    // 6. Database Indexes (including partial unique indexes)
    const indexesRes = await pool.query<{ tablename: string; indexname: string; indexdef: string }>(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);

    console.log("\n6. Database Indexes & Partial Unique Constraints:");
    const existingIndexNames = indexesRes.rows.map((r) => r.indexname);
    for (const expectedIdx of EXPECTED_INDEXES) {
      if (!existingIndexNames.includes(expectedIdx)) {
        throw new Error(`Metadata Assertion Failed: Missing index '${expectedIdx}' in PostgreSQL schema.`);
      }
    }

    // Verify partial unique indexes have WHERE clauses
    const revokedIdx = indexesRes.rows.find((r) => r.indexname === "api_key_audit_events_key_revoked_idx");
    if (!revokedIdx || !revokedIdx.indexdef.includes("WHERE (event_type = 'revoked'::text)")) {
      throw new Error("Metadata Assertion Failed: 'api_key_audit_events_key_revoked_idx' is missing required partial WHERE predicate.");
    }
    console.log(`   - ${revokedIdx.indexname} -> ${revokedIdx.indexdef}`);

    const rotationIdx = indexesRes.rows.find((r) => r.indexname === "api_key_audit_events_related_rotation_idx");
    if (!rotationIdx || !rotationIdx.indexdef.includes("WHERE (event_type = 'rotation_created'::text)")) {
      throw new Error("Metadata Assertion Failed: 'api_key_audit_events_related_rotation_idx' is missing required partial WHERE predicate.");
    }
    console.log(`   - ${rotationIdx.indexname} -> ${rotationIdx.indexdef}`);

    const subActiveIdx = indexesRes.rows.find((r) => r.indexname === "billing_subscriptions_org_active_idx");
    if (
      !subActiveIdx ||
      (!subActiveIdx.indexdef.includes("NOT IN ('canceled'::text, 'incomplete_expired'::text)") &&
        !subActiveIdx.indexdef.includes("status <> ALL (ARRAY['canceled'::text, 'incomplete_expired'::text])") &&
        !subActiveIdx.indexdef.includes("status <> 'canceled'::text") &&
        !subActiveIdx.indexdef.includes("status <> ALL (ARRAY['canceled'"))
    ) {
      throw new Error(
        `Metadata Assertion Failed: 'billing_subscriptions_org_active_idx' is missing required partial WHERE predicate. Actual: ${subActiveIdx?.indexdef}`
      );
    }
    console.log(`   - ${subActiveIdx.indexname} -> ${subActiveIdx.indexdef}`);

    const checkoutActiveIdx = indexesRes.rows.find(
      (r) => r.indexname === "billing_checkout_sessions_active_org_idx"
    );
    if (
      !checkoutActiveIdx ||
      (!checkoutActiveIdx.indexdef.includes("status = ANY (ARRAY['creating'::text, 'open'::text])") &&
        !checkoutActiveIdx.indexdef.includes("status = ANY (ARRAY['creating'") &&
        !checkoutActiveIdx.indexdef.includes("IN ('creating'::text, 'open'::text)"))
    ) {
      throw new Error(
        `Metadata Assertion Failed: 'billing_checkout_sessions_active_org_idx' is missing required partial WHERE predicate. Actual: ${checkoutActiveIdx?.indexdef}`
      );
    }
    console.log(`   - ${checkoutActiveIdx.indexname} -> ${checkoutActiveIdx.indexdef}`);

    console.log(`   ✅ All ${EXPECTED_INDEXES.length} expected query and partial unique indexes verified.`);

    console.log("\n==================================================");
    console.log("🎉 ALL POSTGRESQL METADATA ASSERTIONS PASSED!");
    console.log("==================================================");
  } catch (err) {
    runError = err as Error;
    console.error("❌ Metadata Verification Failed:", (err as Error).message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }

  if (runError) {
    throw runError;
  }
}

if (process.argv[1]?.endsWith("verify-metadata.ts") || process.argv[1]?.endsWith("verify-metadata.js")) {
  verifyDbMetadata();
}
