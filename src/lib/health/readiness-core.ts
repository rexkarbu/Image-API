import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { Redis } from "@upstash/redis";
import { getValidatedRedisConfig, type RedisSafetyEnv } from "@/lib/ratelimit/redis-safety-core";

export interface ReadinessCheckResult {
  allHealthy: boolean;
  database: "healthy" | "unhealthy";
  redis: "healthy" | "unhealthy";
}

const HEX_64_REGEX = /^[0-9a-f]{64}$/;

/**
 * Validates production/preview healthcheck authorization in constant time.
 * In development / test mode, unauthenticated loopback checks are permitted.
 */
export function verifyHealthAuth(
  authHeader: string | null,
  isProduction: boolean,
  healthSecret?: string
): boolean {
  if (!isProduction) {
    return true;
  }

  if (!healthSecret || !HEX_64_REGEX.test(healthSecret)) {
    return false;
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  const providedToken = authHeader.slice(7).trim();
  if (providedToken.length !== healthSecret.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedToken, "utf8"),
      Buffer.from(healthSecret, "utf8")
    );
  } catch {
    return false;
  }
}

/**
 * Validates PostgreSQL database readiness with real connection and query timeout bounds.
 * If timeout occurs, the client is destroyed rather than returned to the reusable pool.
 * If connect() resolves late after a timeout, the late client is immediately destroyed.
 */
export async function executeBoundedDatabaseCheck(
  pool: Pool | { connect: () => Promise<PoolClient> },
  timeoutMs = 2000
): Promise<boolean> {
  let isTimedOut = false;
  let acquiredClient: PoolClient | null = null;
  let timer: NodeJS.Timeout | null = null;

  try {
    const connectPromise = pool.connect().then((client) => {
      if (isTimedOut) {
        // Late resolution after timeout: destroy client immediately
        try {
          (client as any).release(true);
        } catch {
          // Safe ignore
        }
        return null;
      }
      acquiredClient = client;
      return client;
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        isTimedOut = true;
        reject(new Error("db_readiness_timeout"));
      }, timeoutMs);
    });

    // Attach rejection handler to prevent unhandled rejection
    connectPromise.catch(() => {});

    const client = await Promise.race([connectPromise, timeoutPromise]);
    if (!client) {
      return false;
    }

    const queryPromise = (client as any).query("SELECT 1 AS ready");
    queryPromise.catch(() => {});

    const res = (await Promise.race([queryPromise, timeoutPromise])) as {
      rows?: Array<{ ready?: unknown }>;
    };

    if (
      res &&
      Array.isArray(res.rows) &&
      res.rows.length === 1 &&
      (res.rows[0]?.ready === 1 || res.rows[0]?.ready === "1")
    ) {
      // Valid query completed within bounds: release normally
      acquiredClient = null;
      client.release();
      return true;
    }

    // Malformed query result: destroy client
    acquiredClient = null;
    (client as any).release(true);
    return false;
  } catch {
    // Timeout or error: destroy acquired client so no corrupted connection returns to pool
    if (acquiredClient) {
      try {
        (acquiredClient as any).release(true);
      } catch {
        // Safe ignore
      }
      acquiredClient = null;
    }
    return false;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Creates a dedicated bounded Upstash Redis client using the official constructor signal factory.
 */
export function createBoundedRedisClient(
  timeoutMs = 2000,
  env: RedisSafetyEnv = process.env
): Redis {
  const config = getValidatedRedisConfig(env);
  return new Redis({
    url: config.restUrl,
    token: config.restToken,
    signal: () => AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Validates Upstash Redis readiness using the official Upstash Redis client with constructor-level signal.
 * Calls ping() with zero arguments.
 */
export async function executeBoundedRedisCheck(
  redis: Redis | { ping: () => Promise<unknown> }
): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch {
    return false;
  }
}

/**
 * Evaluates full readiness in parallel against database pool and bounded Redis client.
 */
export async function evaluateReadiness(
  deps: {
    pool: Pool | { connect: () => Promise<PoolClient> };
    redis: Redis | { ping: () => Promise<unknown> };
  },
  timeoutMs = 2000
): Promise<ReadinessCheckResult> {
  const [dbHealthy, redisHealthy] = await Promise.all([
    executeBoundedDatabaseCheck(deps.pool, timeoutMs),
    executeBoundedRedisCheck(deps.redis),
  ]);

  return {
    allHealthy: dbHealthy && redisHealthy,
    database: dbHealthy ? "healthy" : "unhealthy",
    redis: redisHealthy ? "healthy" : "unhealthy",
  };
}
