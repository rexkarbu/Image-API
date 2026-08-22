import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function runMigrations() {
  console.log("⏳ Running database migrations from ./drizzle...");
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✅ Database migrations applied successfully.");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
