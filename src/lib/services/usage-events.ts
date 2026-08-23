import "server-only";

import { db } from "@/db";
import { usageEvents } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { eq, and } from "drizzle-orm";
import crypto from "node:crypto";

export interface RecordUsageEventInput {
  requestId: string; // 64-char SHA-256 hash
  organizationId: string;
  apiKeyId: string;
  endpoint: string;
  units?: number;
  statusCode?: number;
}

/**
 * Checks if an idempotency request_id has already been processed within the tenant organization.
 * Used for early rejection before expensive multipart/image decoding when possible.
 */
export async function isDuplicateRequest(
  requestId: string,
  organizationId: string
): Promise<boolean> {
  try {
    const existing = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(and(eq(usageEvents.requestId, requestId), eq(usageEvents.organizationId, organizationId)))
      .limit(1);

    return existing.length > 0;
  } catch {
    // If lookup fails, proceed to atomic insert conflict handling
    return false;
  }
}

/**
 * Records a billable usage event atomically in PostgreSQL.
 * Uses ON CONFLICT (request_id) DO NOTHING to serialize concurrent requests.
 * Throws 409 DUPLICATE_REQUEST if a request with this idempotency key was already recorded.
 * Throws 503 METERING_UNAVAILABLE if the database write encounters an unexpected error.
 */
export async function recordUsageEvent(
  input: RecordUsageEventInput,
  correlationId: string
): Promise<{ id: string }> {
  try {
    const rows = await db
      .insert(usageEvents)
      .values({
        id: crypto.randomUUID(),
        requestId: input.requestId,
        organizationId: input.organizationId,
        apiKeyId: input.apiKeyId,
        endpoint: input.endpoint,
        units: input.units ?? 1,
        statusCode: input.statusCode ?? 200,
      })
      .onConflictDoNothing({ target: usageEvents.requestId })
      .returning({ id: usageEvents.id });

    if (rows.length === 0) {
      throw new ApiError(
        409,
        "DUPLICATE_REQUEST",
        "A request with this Idempotency-Key has already been processed.",
        correlationId
      );
    }

    return { id: rows[0].id };
  } catch (err) {
    if (err instanceof ApiError) throw err;

    console.error(`[Metering Database Failure] correlationId=${correlationId}`);
    throw new ApiError(
      503,
      "METERING_UNAVAILABLE",
      "Usage metering service is temporarily unavailable. The request could not be finalized.",
      correlationId
    );
  }
}
