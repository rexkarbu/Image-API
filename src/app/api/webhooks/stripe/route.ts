import { NextRequest, NextResponse } from "next/server";
import { verifyAndRecordWebhookEvent } from "@/lib/services/billing-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe-Signature header." },
      { status: 400 }
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_WEBHOOK_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Webhook payload exceeds maximum size limit." },
      { status: 413 }
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read webhook request payload." },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_PAYLOAD_BYTES) {
    return NextResponse.json(
      { error: "Webhook payload exceeds maximum size limit." },
      { status: 413 }
    );
  }

  try {
    const result = await verifyAndRecordWebhookEvent(rawBody, signature);
    return NextResponse.json({ received: true, id: result.eventId });
  } catch (err) {
    console.error("[Webhook Error] Signature verification or recording failed:", (err as Error).message);
    return NextResponse.json(
      { error: "Webhook verification failed." },
      { status: 400 }
    );
  }
}
