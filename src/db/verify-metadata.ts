import { Pool } from "pg";
import * as dotenv from "dotenv";
import { assertDevelopmentDatabaseSafety } from "./development-safety";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

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

interface ExpectedFk {
  table: string;
  column: string;
  foreignTable: string;
  foreignColumn: string;
  deleteRule: string;
}

const EXPECTED_FKS: ExpectedFk[] = [
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

const EXPECTED_UNIQUE: { table: string; column: string }[] = [
  { table: "api_keys", column: "key_hash" },
  { table: "session", column: "token" },
  { table: "usage_events", column: "request_id" },
  { table: "user", column: "email" },
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
  "usage_events_org_created_idx",
  "usage_events_key_created_idx",
];

async function verifyDbMetadata() {
  assertDevelopmentDatabaseSafety();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("❌ Metadata verification failed: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    max: 1,
  });

  try {
    console.log("=== PostgreSQL Database Metadata Verification (Fail-Closed) ===");

    // 1. Table assertions
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

    // 2. Foreign Key Delete Rule assertions
    const fksRes = await pool.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
    }>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name;
    `);

    console.log("\n2. Foreign Key Delete Rules:");
    for (const expectedFk of EXPECTED_FKS) {
      const match = fksRes.rows.find(
        (r) =>
          r.table_name === expectedFk.table &&
          r.column_name === expectedFk.column &&
          r.foreign_table_name === expectedFk.foreignTable &&
          r.foreign_column_name === expectedFk.foreignColumn
      );

      if (!match) {
        throw new Error(
          `Metadata Assertion Failed: Missing FK ${expectedFk.table}.${expectedFk.column} -> ${expectedFk.foreignTable}.${expectedFk.foreignColumn}`
        );
      }

      if (match.delete_rule !== expectedFk.deleteRule) {
        throw new Error(
          `Metadata Assertion Failed: FK ${expectedFk.table}.${expectedFk.column} has delete rule '${match.delete_rule}', expected '${expectedFk.deleteRule}'`
        );
      }
      console.log(`   - ${match.table_name}.${match.column_name} -> ${match.foreign_table_name}.${match.foreign_column_name} (ON DELETE ${match.delete_rule})`);
    }
    console.log(`   ✅ All ${EXPECTED_FKS.length} foreign key delete rules verified.`);

    // 3. Unique Constraint assertions
    const uqRes = await pool.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
    }>(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name;
    `);

    console.log("\n3. Unique Constraints:");
    for (const expectedUq of EXPECTED_UNIQUE) {
      const match = uqRes.rows.find(
        (r) => r.table_name === expectedUq.table && r.column_name === expectedUq.column
      );
      if (!match) {
        throw new Error(
          `Metadata Assertion Failed: Missing UNIQUE constraint on ${expectedUq.table}.${expectedUq.column}`
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
        ON tc.constraint_name = cc.constraint_name
      WHERE tc.table_schema = 'public' AND tc.constraint_type = 'CHECK'
        AND tc.constraint_name NOT LIKE '%_not_null'
      ORDER BY tc.table_name;
    `);

    console.log("\n4. Check Constraints:");
    const requiredChecks = [
      { table: "usage_events", pattern: "units > 0", name: "usage_events_units_positive" },
      { table: "api_key_audit_events", pattern: "created", name: "api_key_audit_events_type_check" },
      { table: "api_keys", pattern: "active", name: "api_keys_status_check" },
      { table: "api_keys", pattern: "64", name: "api_keys_key_hash_length" },
      { table: "api_keys", pattern: "img_live_", name: "api_keys_key_prefix_check" },
    ];

    for (const check of requiredChecks) {
      const match = checksRes.rows.find(
        (r) => r.table_name === check.table && r.check_clause.includes(check.pattern)
      );
      if (!match) {
        throw new Error(`Metadata Assertion Failed: Missing check constraint matching '${check.pattern}' on ${check.table}.`);
      }
      console.log(`   - ${match.table_name}: ${match.constraint_name} -> ${match.check_clause}`);
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

    // 6. Index assertions
    const indexesRes = await pool.query<{ tablename: string; indexname: string }>(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);

    console.log("\n6. Database Indexes:");
    const existingIndexNames = indexesRes.rows.map((r) => r.indexname);
    for (const expectedIdx of EXPECTED_INDEXES) {
      if (!existingIndexNames.includes(expectedIdx)) {
        throw new Error(`Metadata Assertion Failed: Missing index '${expectedIdx}' in PostgreSQL schema.`);
      }
    }
    console.log(`   ✅ All ${EXPECTED_INDEXES.length} expected query indexes verified.`);

    console.log("\n==================================================");
    console.log("🎉 ALL POSTGRESQL METADATA ASSERTIONS PASSED!");
    console.log("==================================================");
  } catch (err) {
    console.error("❌ Metadata Verification Failed:", (err as Error).message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyDbMetadata();
