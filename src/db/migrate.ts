import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function runMigrations() {
  const connectionString =
    process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      "❌ Migration failed: Neither DIRECT_DATABASE_URL nor DATABASE_URL is defined."
    );
    process.exit(1);
  }

  const migrationPool = new Pool({
    connectionString,
    max: 1,
  });

  const migrationDb = drizzle(migrationPool);

  console.log("⏳ Running database migrations from ./drizzle using direct connection...");
  try {
    await migrate(migrationDb, { migrationsFolder: "./drizzle" });
    console.log("✅ Database migrations applied successfully.");
  } catch (error) {
    console.error("❌ Migration execution failed:", (error as Error).message || error);
    process.exit(1);
  } finally {
    await migrationPool.end();
  }
}
runMigrations();
