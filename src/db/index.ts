import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { validatePostgresUrlSecurity } from "./ssl-validation";

/**
 * Reusable server-side PostgreSQL client.
 *
 * In development, uses a global singleton pool to avoid leaking connections
 * across Next.js fast-refresh / hot-reload cycles.
 * Uses provider-neutral node-postgres Pool compatible with standard PostgreSQL
 * connection pooling.
 *
 * Safe for build-time static evaluation and testing imports when DATABASE_URL
 * is not actively connecting to a remote host.
 */
declare global {
  var __pgPool: Pool | undefined;
  var __dbInstance: NodePgDatabase<typeof schema> | undefined;
}

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  const isProductionOrPreview =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview";

  if (url && url.trim() !== "") {
    return url.trim();
  }

  if (!isProductionOrPreview) {
    return "postgres://postgres:postgres@localhost:5432/image_api_db";
  }

  throw new Error("Production Configuration Error: DATABASE_URL is missing.");
}

function getDatabasePool(): Pool {
  if (globalThis.__pgPool) {
    return globalThis.__pgPool;
  }

  const connString = getConnectionString();
  validatePostgresUrlSecurity(connString, "DATABASE_URL");

  const poolInstance = new Pool({
    connectionString: connString,
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__pgPool = poolInstance;
  }

  return poolInstance;
}

export const pool = getDatabasePool();

export const db: NodePgDatabase<typeof schema> =
  globalThis.__dbInstance ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== "production") {
  globalThis.__dbInstance = db;
}

export type DbClient = NodePgDatabase<typeof schema>;
