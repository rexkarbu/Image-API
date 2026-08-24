import crypto from "node:crypto";

export interface ReadinessDependencies {
  queryDatabase: () => Promise<unknown>;
  pingRedis: () => Promise<unknown>;
}

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
 * Validates PostgreSQL database readiness.
 * Requires exact row shape with ready === 1 (or "1").
 */
export async function checkDatabaseReadiness(
  queryFn: () => Promise<unknown>,
  timeoutMs = 2000
): Promise<boolean> {
  try {
    const queryPromise = queryFn();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("db_query_timeout")), timeoutMs);
    });

    const result = (await Promise.race([queryPromise, timeoutPromise])) as {
      rows?: Array<{ ready?: unknown }>;
    };

    if (
      result &&
      Array.isArray(result.rows) &&
      result.rows.length === 1 &&
      (result.rows[0]?.ready === 1 || result.rows[0]?.ready === "1")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates Upstash Redis readiness.
 * Requires exact return value "PONG".
 */
export async function checkRedisReadiness(
  pingFn: () => Promise<unknown>,
  timeoutMs = 2000
): Promise<boolean> {
  try {
    const pingPromise = pingFn();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("redis_ping_timeout")), timeoutMs);
    });

    const result = await Promise.race([pingPromise, timeoutPromise]);
    return result === "PONG";
  } catch {
    return false;
  }
}

/**
 * Evaluates full readiness in parallel against provided dependencies.
 */
export async function evaluateReadiness(
  deps: ReadinessDependencies,
  timeoutMs = 2000
): Promise<ReadinessCheckResult> {
  const [dbHealthy, redisHealthy] = await Promise.all([
    checkDatabaseReadiness(deps.queryDatabase, timeoutMs),
    checkRedisReadiness(deps.pingRedis, timeoutMs),
  ]);

  return {
    allHealthy: dbHealthy && redisHealthy,
    database: dbHealthy ? "healthy" : "unhealthy",
    redis: redisHealthy ? "healthy" : "unhealthy",
  };
}
