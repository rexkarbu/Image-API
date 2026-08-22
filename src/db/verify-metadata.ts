import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function verifyDbMetadata() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  try {
    console.log("=== PostgreSQL Database Metadata Verification ===");

    // 1. Table list
    const tables = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    console.log("\n1. Tables in database:");
    tables.rows.forEach((r) => console.log(`   - ${r.table_name}`));

    // 2. Foreign Key Actions
    const fks = await pool.query<{
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
    fks.rows.forEach((r) => {
      console.log(`   - ${r.table_name}.${r.column_name} -> ${r.foreign_table_name}.${r.foreign_column_name} (ON DELETE ${r.delete_rule})`);
    });

    // 3. Unique Constraints
    const uq = await pool.query<{
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
    uq.rows.forEach((r) => {
      console.log(`   - ${r.table_name}.${r.column_name} (${r.constraint_name})`);
    });

    // 4. Check Constraints
    const checks = await pool.query<{
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
    checks.rows.forEach((r) => {
      console.log(`   - ${r.table_name}: ${r.constraint_name} -> ${r.check_clause}`);
    });

    // 5. Plaintext API key check
    const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'api_keys' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.log("\n5. Columns in api_keys table:");
    const hasPlaintextKey = columns.rows.some((c) =>
      ["key", "api_key", "secret", "token", "plaintext"].includes(c.column_name.toLowerCase())
    );
    columns.rows.forEach((c) => console.log(`   - ${c.column_name} (${c.data_type}, nullable: ${c.is_nullable})`));
    console.log(`   -> Plaintext key column detected: ${hasPlaintextKey ? "YES (VIOLATION)" : "NO (SECURE)"}`);

    // 6. Indexes
    const indexes = await pool.query<{ tablename: string; indexname: string }>(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);
    console.log("\n6. Database Indexes:");
    indexes.rows.forEach((r) => console.log(`   - ${r.tablename} -> ${r.indexname}`));

    console.log("\n✅ PostgreSQL Schema & Metadata Audit Complete.");
  } finally {
    await pool.end();
  }
}

verifyDbMetadata();
