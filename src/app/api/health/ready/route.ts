import { NextResponse } from "next/server";
import { pool } from "@/db";
import { getRedisClient } from "@/lib/ratelimit/redis-safety";
import { resolveRequestId, logger } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHECK_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${name}_timeout`));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return withSpan(
    "health.ready",
    async (span) => {
      // 1. Check PostgreSQL
      const dbPromise = withTimeout(
        pool.query("SELECT 1 AS ready"),
        CHECK_TIMEOUT_MS,
        "database"
      );

      // 2. Check Upstash Redis
      const redisPromise = withTimeout(
        (async () => {
          const redis = getRedisClient();
          return await redis.ping();
        })(),
        CHECK_TIMEOUT_MS,
        "redis"
      );

      const [dbResult, redisResult] = await Promise.allSettled([dbPromise, redisPromise]);

      const databaseHealthy = dbResult.status === "fulfilled";
      const redisHealthy = redisResult.status === "fulfilled";
      const allHealthy = databaseHealthy && redisHealthy;

      const durationMs = Date.now() - startTime;
      const statusCode = allHealthy ? 200 : 503;

      span.setAttribute("health.database", databaseHealthy ? "healthy" : "unhealthy");
      span.setAttribute("health.redis", redisHealthy ? "healthy" : "unhealthy");
      span.setAttribute("health.status", allHealthy ? "ready" : "unhealthy");

      if (allHealthy) {
        logger.debug("health.ready_checked", {
          requestId,
          route: "/api/health/ready",
          method: "GET",
          statusCode: 200,
          durationMs,
          outcome: "success",
          details: {
            database: "healthy",
            redis: "healthy",
          },
        });
      } else {
        logger.warn("health.ready_degraded", {
          requestId,
          route: "/api/health/ready",
          method: "GET",
          statusCode: 503,
          durationMs,
          outcome: "failure",
          errorCode: "HEALTH_CHECK_FAILED",
          details: {
            database: databaseHealthy ? "healthy" : "unhealthy",
            redis: redisHealthy ? "healthy" : "unhealthy",
          },
        });
      }

      return NextResponse.json(
        {
          status: allHealthy ? "ready" : "unhealthy",
          service: "image-api",
          checks: {
            database: databaseHealthy ? "healthy" : "unhealthy",
            redis: redisHealthy ? "healthy" : "unhealthy",
          },
        },
        {
          status: statusCode,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Request-ID": requestId,
          },
        }
      );
    },
    { "http.route": "/api/health/ready", "http.method": "GET" }
  );
}
