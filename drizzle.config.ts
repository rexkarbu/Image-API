import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Drizzle Kit Configuration
 *
 * For live database commands (migrate, push, introspect), Drizzle Kit requires
 * DIRECT_DATABASE_URL (unpooled direct connection).
 *
 * For offline commands that do not connect (generate, check), an offline
 * placeholder URL is used to prevent requiring a reachable database.
 * The pooled runtime DATABASE_URL is never used for migrations.
 */
const migrationDbUrl =
  process.env.DIRECT_DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/offline_placeholder_db";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationDbUrl,
  },
  verbose: true,
  strict: true,
});
