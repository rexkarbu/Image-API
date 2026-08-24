import { NextRequest, NextResponse } from "next/server";
import { verifyAndRecordWebhookEvent } from "@/lib/services/billing-webhooks";
import { resolveRequestId, logger } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/tracer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  return withSpan(
    "billing.webhook.record",
    async (span) => {
      span.setAttribute("http.method", "POST");
      span.setAttribute("http.route", "/api/webhooks/stripe");

      const signature = request.headers.get("stripe-signature");
      if (!signature) {
        logger.warn("billing.webhook_rejected", {
          requestId,
          route: "/api/webhooks/stripe",
          method: "POST",
          statusCode: 400,
          durationMs: Date.now() - startTime,
          outcome: "rejected",
          errorCode: "MISSING_STRIPE_SIGNATURE",
        });

        return NextResponse.json(
          { error: "Missing Stripe-Signature header." },
          { status: 400, headers: { "X-Request-ID": requestId } }
        );
      }

      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_WEBHOOK_PAYLOAD_BYTES) {
        logger.warn("billing.webhook_rejected", {
          requestId,
          route: "/api/webhooks/stripe",
          method: "POST",
          statusCode: 413,
          durationMs: Date.now() - startTime,
          outcome: "rejected",
          errorCode: "PAYLOAD_TOO_LARGE",
        });

        return NextResponse.json(
          { error: "Webhook payload exceeds maximum size limit." },
          { status: 413, headers: { "X-Request-ID": requestId } }
        );
      }

      let rawBody: string;
      try {
        rawBody = await request.text();
      } catch {
        return NextResponse.json(
          { error: "Failed to read webhook request payload." },
          { status: 400, headers: { "X-Request-ID": requestId } }
        );
      }

      if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_PAYLOAD_BYTES) {
        return NextResponse.json(
          { error: "Webhook payload exceeds maximum size limit." },
          { status: 413, headers: { "X-Request-ID": requestId } }
        );
      }

      try {
        const result = await verifyAndRecordWebhookEvent(rawBody, signature);
        const durationMs = Date.now() - startTime;

        logger.info("billing.webhook_accepted", {
          requestId,
          route: "/api/webhooks/stripe",
          method: "POST",
          statusCode: 200,
          durationMs,
          outcome: "success",
          details: {
            eventId: result.eventId,
          },
        });

        return NextResponse.json(
          { received: true, id: result.eventId },
          { status: 200, headers: { "X-Request-ID": requestId } }
        );
      } catch (err) {
        const durationMs = Date.now() - startTime;
        logger.error("billing.webhook_verification_failed", {
          requestId,
          route: "/api/webhooks/stripe",
          method: "POST",
          statusCode: 400,
          durationMs,
          outcome: "failure",
          errorCode: (err as Error).message || "WEBHOOK_VERIFICATION_FAILED",
        });

        return NextResponse.json(
          { error: "Webhook verification failed." },
          { status: 400, headers: { "X-Request-ID": requestId } }
        );
      }
    },
    { "http.route": "/api/webhooks/stripe", "http.method": "POST" }
  );
}
