import { Pool } from "pg";
import * as dotenv from "dotenv";
import { assertDevelopmentDatabaseSafety } from "./development-safety";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

export interface CheckConstraintRule {
  table: string;
  name: string;
  validate: (normalizedClause: string) => boolean;
  description: string;
}

export function normalizeCheckClause(clause: string): string {
  return clause
    .replace(/::text/g, "")
    .replace(/::[a-z0-9_]+/gi, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const REQUIRED_CHECK_CONSTRAINTS: CheckConstraintRule[] = [
  {
    table: "usage_events",
    name: "usage_events_units_equals_one",
    validate: (c) => c.includes("units = 1"),
    description: "units = 1",
  },
  {
    table: "usage_events",
    name: "usage_events_request_id_format",
    validate: (c) => c.includes("^[0-9a-f]{64}$"),
    description: "request_id ~ '^[0-9a-f]{64}$'",
  },
  {
    table: "usage_events",
    name: "usage_events_status_code_2xx",
    validate: (c) =>
      c.includes("status_code >= 200") &&
      c.includes("status_code <= 299"),
    description: "status_code >= 200 AND status_code <= 299",
  },
  {
    table: "api_key_audit_events",
    name: "api_key_audit_events_type_check",
    validate: (c) => {
      const hasAll =
        c.includes("'created'") &&
        c.includes("'revoked'") &&
        c.includes("'rotation_created'") &&
        c.includes("'expiration_scheduled'");
      return hasAll && c.includes("event_type");
    },
    description: "event_type IN ('created', 'revoked', 'rotation_created', 'expiration_scheduled')",
  },
  {
    table: "api_keys",
    name: "api_keys_status_check",
    validate: (c) => {
      const hasAll = c.includes("'active'") && c.includes("'revoked'");
      return hasAll && c.includes("status");
    },
    description: "status IN ('active', 'revoked')",
  },
  {
    table: "api_keys",
    name: "api_keys_key_hash_format",
    validate: (c) => c.includes("^[0-9a-f]{64}$"),
    description: "key_hash ~ '^[0-9a-f]{64}$'",
  },
  {
    table: "api_keys",
    name: "api_keys_key_prefix_format",
    validate: (c) => c.includes("^img_live_[A-Za-z0-9_-]{8}$"),
    description: "key_prefix ~ '^img_live_[A-Za-z0-9_-]{8}$'",
  },
  {
    table: "api_keys",
    name: "api_keys_status_revoked_consistency",
    validate: (c) =>
      c.includes("status = 'active'") &&
      c.includes("revoked_at IS NULL") &&
      c.includes("status = 'revoked'") &&
      c.includes("revoked_at IS NOT NULL"),
    description: "(status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL)",
  },
  {
    table: "api_keys",
    name: "api_keys_scopes_check",
    validate: (c) => c.includes("image:transform"),
    description: "scopes = 'image:transform'",
  },
  {
    table: "api_keys",
    name: "api_keys_expires_at_check",
    validate: (c) =>
      c.includes("expires_at IS NULL") &&
      c.includes("expires_at > created_at"),
    description: "expires_at IS NULL OR expires_at > created_at (both invariants required)",
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
];

const EXPECTED_UNIQUE = [
  { table: "api_keys", column: "key_hash", name: "api_keys_key_hash_unique" },
  { table: "session", column: "token", name: "session_token_unique" },
  { table: "usage_events", column: "request_id", name: "usage_events_request_id_unique" },
  { table: "user", column: "email", name: "user_email_unique" },
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
];

export async function verifyDbMetadata() {
  assertDevelopmentDatabaseSafety();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not defined in environment.");
  }

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
    console.log("   ✅ All required check constraints verified.");

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
