import crypto from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Redis } from "@upstash/redis";

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
 * Validates PostgreSQL database readiness with a real checked-out client, driver timeout,
 * bounded query cancellation, and guaranteed release in finally.
 */
export async function executeBoundedDatabaseCheck(
  pool: Pool | { connect: () => Promise<PoolClient> },
  timeoutMs = 2000
): Promise<boolean> {
  let client: PoolClient | null = null;
  let timer: NodeJS.Timeout | null = null;

  try {
    const connectPromise = pool.connect();
    const connectTimeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("db_connect_timeout")), timeoutMs);
    });

    client = await Promise.race([connectPromise, connectTimeoutPromise]);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const queryTimeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("db_query_timeout")), timeoutMs);
    });

    // Query on checked-out client with bounded Promise race
    const res = (await Promise.race([
      client.query("SELECT 1 AS ready"),
      queryTimeoutPromise,
    ])) as { rows?: Array<{ ready?: unknown }> };

    if (
      res &&
      Array.isArray(res.rows) &&
      res.rows.length === 1 &&
      (res.rows[0]?.ready === 1 || res.rows[0]?.ready === "1")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (client) {
      try {
        client.release();
      } catch {
        // Safe swallow if client already destroyed
      }
    }
  }
}

/**
 * Validates Upstash Redis readiness using an AbortSignal to ensure the underlying
 * network operation is cancelled on timeout.
 */
export async function executeBoundedRedisCheck(
  redis: Redis | { ping: (options?: unknown) => Promise<unknown> },
  timeoutMs = 2000
): Promise<boolean> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("redis_ping_timeout"));
      }, timeoutMs);
    });

    const pingPromise = (async () => {
      // @upstash/redis supports signal in options or fetch
      return await (redis as any).ping({ signal: controller.signal });
    })();

    const result = await Promise.race([pingPromise, timeoutPromise]);
    return result === "PONG";
  } catch {
    return false;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Evaluates full readiness in parallel against real or mock database and Redis instances.
 */
export async function evaluateReadiness(
  deps: {
    pool: Pool | { connect: () => Promise<PoolClient> };
    redis: Redis | { ping: (options?: unknown) => Promise<unknown> };
  },
  timeoutMs = 2000
): Promise<ReadinessCheckResult> {
  const [dbHealthy, redisHealthy] = await Promise.all([
    executeBoundedDatabaseCheck(deps.pool, timeoutMs),
    executeBoundedRedisCheck(deps.redis, timeoutMs),
  ]);

  return {
    allHealthy: dbHealthy && redisHealthy,
    database: dbHealthy ? "healthy" : "unhealthy",
    redis: redisHealthy ? "healthy" : "unhealthy",
  };
}
