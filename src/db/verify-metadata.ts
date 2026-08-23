import { Pool } from "pg";
import * as dotenv from "dotenv";
import { assertDevelopmentDatabaseSafety } from "./development-safety";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const EXPECTED_TABLES = [
  "account",
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
  "api_keys_active_lookup_idx",
  "api_keys_created_by_idx",
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
    console.log("   ✅ All required application tables present.");

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
    console.log("   ✅ All foreign key delete rules verified.");

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
    console.log("   ✅ All required unique constraints verified.");

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
    const positiveUnitsCheck = checksRes.rows.find(
      (r) => r.table_name === "usage_events" && r.check_clause.includes("units > 0")
    );
    if (!positiveUnitsCheck) {
      throw new Error(
        "Metadata Assertion Failed: Missing check constraint 'usage_events_units_positive' (units > 0) on usage_events table."
      );
    }
    console.log(`   - ${positiveUnitsCheck.table_name}: ${positiveUnitsCheck.constraint_name} -> ${positiveUnitsCheck.check_clause}`);
    console.log("   ✅ usage_events_units_positive check constraint verified.");

    // 5. Plaintext API key check
    const columnsRes = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'api_keys' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.log("\n5. Columns in api_keys table:");
    columnsRes.rows.forEach((c) => console.log(`   - ${c.column_name} (${c.data_type})`));
    const suspiciousPlaintextColumn = columnsRes.rows.find((c) =>
      ["key", "api_key", "secret", "token", "plaintext"].includes(c.column_name.toLowerCase())
    );
    if (suspiciousPlaintextColumn) {
      throw new Error(
        `Metadata Assertion Failed: Plaintext key column '${suspiciousPlaintextColumn.column_name}' detected in api_keys table!`
      );
    }
    console.log("   ✅ Zero plaintext key columns detected in api_keys table.");

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
