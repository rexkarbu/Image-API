import { NextRequest, NextResponse } from "next/server";
import { runBillingWorker } from "@/lib/services/billing-worker";
import { getValidatedStripeConfig } from "@/lib/stripe/safety";
import { resolveRequestId, logger } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracer";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeSecretMatch(expectedSecret: string, providedAuthHeader: string | null): boolean {
  if (!providedAuthHeader || !providedAuthHeader.startsWith("Bearer ")) {
    return false;
  }
  const providedToken = providedAuthHeader.slice(7).trim();
  if (providedToken.length !== expectedSecret.length) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(providedToken, "utf8"),
    Buffer.from(expectedSecret, "utf8")
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return withSpan(
    "billing.cron.run",
    async (span) => {
      span.setAttribute("http.method", "GET");
      span.setAttribute("http.route", "/api/cron/billing");

      const authHeader = request.headers.get("authorization");
      let cronSecret: string | undefined;

      try {
        const config = getValidatedStripeConfig();
        cronSecret = config.cronSecret || process.env.CRON_SECRET;
      } catch {
        logger.error("billing.cron_config_unavailable", {
          requestId,
          route: "/api/cron/billing",
          method: "GET",
          statusCode: 503,
          durationMs: Date.now() - startTime,
          outcome: "error",
          errorCode: "STRIPE_CONFIG_UNAVAILABLE",
        });

        return NextResponse.json(
          { error: "Billing service unavailable." },
          { status: 503, headers: { "X-Request-ID": requestId } }
        );
      }

      if (!cronSecret || !timingSafeSecretMatch(cronSecret, authHeader)) {
        logger.warn("billing.cron_unauthorized", {
          requestId,
          route: "/api/cron/billing",
          method: "GET",
          statusCode: 401,
          durationMs: Date.now() - startTime,
          outcome: "unauthorized",
          errorCode: "CRON_UNAUTHORIZED",
        });

        return NextResponse.json(
          { error: "Unauthorized." },
          { status: 401, headers: { "X-Request-ID": requestId } }
        );
      }

      try {
        const summary = await runBillingWorker();
        const durationMs = Date.now() - startTime;

        logger.info("billing.cron_completed", {
          requestId,
          route: "/api/cron/billing",
          method: "GET",
          statusCode: 200,
          durationMs,
          outcome: "success",
          details: {
            processedWebhooks: summary.processedWebhooks,
            provisionedCustomers: summary.provisionedCustomers,
            createdBatches: summary.createdBatches,
            reportedBatches: summary.reportedBatches,
            errorsCount: summary.errors.length,
          },
        });

        return NextResponse.json(
          {
            success: true,
            processedWebhooks: summary.processedWebhooks,
            provisionedCustomers: summary.provisionedCustomers,
            createdBatches: summary.createdBatches,
            reportedBatches: summary.reportedBatches,
            errorsCount: summary.errors.length,
          },
          { status: 200, headers: { "X-Request-ID": requestId } }
        );
      } catch (err) {
        const durationMs = Date.now() - startTime;
        logger.error("billing.cron_execution_failed", {
          requestId,
          route: "/api/cron/billing",
          method: "GET",
          statusCode: 500,
          durationMs,
          outcome: "failure",
          errorCode: (err as Error).name || "CRON_WORKER_FAILED",
        });

        return NextResponse.json(
          { error: "Worker execution failed." },
          { status: 500, headers: { "X-Request-ID": requestId } }
        );
      }
    },
    { "http.route": "/api/cron/billing", "http.method": "GET" }
  );
}
