import { NextResponse } from "next/server";
import { resolveRequestId, logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const startTime = Date.now();
  const requestId = resolveRequestId(request.headers.get("x-request-id"));

  logger.debug("health.live_checked", {
    requestId,
    route: "/api/health/live",
    method: "GET",
    statusCode: 200,
    durationMs: Date.now() - startTime,
    outcome: "success",
  });

  return NextResponse.json(
    {
      status: "ok",
      service: "image-api",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
      },
    }
  );
}
