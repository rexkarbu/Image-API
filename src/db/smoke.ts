import { Pool } from "pg";
import * as dotenv from "dotenv";

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

async function smokeTest() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("❌ Database smoke test failed: DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log("⏳ Connecting to database (runtime pooled connection)...");
    const pingResult = await pool.query("SELECT 1 AS connected;");
    if (pingResult.rows.length === 0 || pingResult.rows[0].connected !== 1) {
      throw new Error("Query SELECT 1 did not return expected result.");
    }
    console.log("✅ Basic connection test passed (SELECT 1 OK).");

    const tablesResult = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const existingTables = tablesResult.rows.map((r) => r.table_name);
    console.log(`ℹ️ Found ${existingTables.length} tables in public schema: [${existingTables.join(", ")}]`);

    const missingTables = EXPECTED_TABLES.filter((t) => !existingTables.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Smoke Test Invariant Failed: Missing required application tables in schema: [${missingTables.join(", ")}].`);
    } else {
      console.log(`✅ All ${EXPECTED_TABLES.length} expected application tables verified in database schema.`);
    }
  } catch (error) {
    console.error("❌ Database smoke test failed:", (error as Error).message || error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log("🔌 Database connection closed cleanly.");
  }
}

smokeTest();
