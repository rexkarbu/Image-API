import { NextRequest, NextResponse } from "next/server";
import { runBillingWorker } from "@/lib/services/billing-worker";
import { getValidatedStripeConfig } from "@/lib/stripe/safety";
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
  const authHeader = request.headers.get("authorization");
  let cronSecret: string | undefined;

  try {
    const config = getValidatedStripeConfig();
    cronSecret = config.cronSecret || process.env.CRON_SECRET;
  } catch {
    return NextResponse.json({ error: "Billing service unavailable." }, { status: 503 });
  }

  if (!cronSecret || !timingSafeSecretMatch(cronSecret, authHeader)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await runBillingWorker();
    return NextResponse.json({
      success: true,
      processedWebhooks: summary.processedWebhooks,
      provisionedCustomers: summary.provisionedCustomers,
      createdBatches: summary.createdBatches,
      reportedBatches: summary.reportedBatches,
      errorsCount: summary.errors.length,
    });
  } catch (err) {
    console.error("[Billing Cron] Worker execution error:", (err as Error).message);
    return NextResponse.json({ error: "Worker execution failed." }, { status: 500 });
  }
}
