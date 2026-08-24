import { NextResponse } from "next/server";
import { pool } from "@/db";
import { getRedisClient } from "@/lib/ratelimit/redis-safety";
import { resolveRequestId, logger } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracer";
import { verifyHealthAuth, evaluateReadiness } from "@/lib/health/readiness-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const startTime = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));
  const authHeader = request.headers.get("authorization");
  const isProduction = process.env.NODE_ENV === "production";
  const healthSecret = process.env.HEALTHCHECK_SECRET;

  // 1. Verify healthcheck authorization in production
  const isAuthorized = verifyHealthAuth(authHeader, isProduction, healthSecret);

  if (!isAuthorized) {
    logger.warn("health.ready_unauthorized", {
      requestId,
      route: "/api/health/ready",
      method: "GET",
      statusCode: 401,
      durationMs: Date.now() - startTime,
      outcome: "unauthorized",
      errorCode: "UNAUTHORIZED",
    });

    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Healthcheck authentication required.",
          requestId,
        },
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Request-ID": requestId,
        },
      }
    );
  }

  return withSpan(
    "health.ready",
    async (span) => {
      // 2. Evaluate dependencies in parallel with strict validation
      const checkResult = await evaluateReadiness(
        {
          queryDatabase: () => pool.query("SELECT 1 AS ready"),
          pingRedis: () => getRedisClient().ping(),
        },
        2000
      );

      const durationMs = Date.now() - startTime;
      const statusCode = checkResult.allHealthy ? 200 : 503;

      span.setAttribute("health.database", checkResult.database);
      span.setAttribute("health.redis", checkResult.redis);
      span.setAttribute("health.status", checkResult.allHealthy ? "ready" : "unhealthy");

      if (checkResult.allHealthy) {
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
            database: checkResult.database,
            redis: checkResult.redis,
          },
        });
      }

      return NextResponse.json(
        {
          status: checkResult.allHealthy ? "ready" : "unhealthy",
          service: "image-api",
          checks: {
            database: checkResult.database,
            redis: checkResult.redis,
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
