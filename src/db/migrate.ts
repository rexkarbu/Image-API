import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { validatePostgresUrlSecurity } from "./ssl-validation";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

async function runMigrations() {
  const directConnectionString = process.env.DIRECT_DATABASE_URL;

  if (!directConnectionString || directConnectionString.trim() === "") {
    console.error(
      "❌ Migration execution failed: DIRECT_DATABASE_URL is required for database migrations. Falling back to pooled DATABASE_URL is not permitted."
    );
    process.exit(1);
  }

  try {
    validatePostgresUrlSecurity(directConnectionString, "DIRECT_DATABASE_URL");
  } catch (err) {
    console.error("❌ Migration security check failed:", (err as Error).message);
    process.exit(1);
  }

  const migrationPool = new Pool({
    connectionString: directConnectionString,
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
