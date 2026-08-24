import "server-only";
import crypto from "node:crypto";
import { trace } from "@opentelemetry/api";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogOutcome =
  | "success"
  | "failure"
  | "error"
  | "rate_limited"
  | "unauthorized"
  | "rejected"
  | "started"
  | "completed";

export interface LogPayload {
  requestId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  outcome?: LogOutcome;
  errorCode?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  service: string;
  environment: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  route?: string;
  method?: string;
  statusCode?: number;
  durationMs?: number;
  outcome?: LogOutcome;
  errorCode?: string;
  details?: Record<string, unknown>;
}

const SENSITIVE_KEY_REGEX = /(?:key|secret|token|auth|cookie|password|database|redis|stripe|conn|url|cert|signature|payload|body|image|card|email)/i;
const ALLOWED_REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Resolves a trusted, bounded Request ID.
 * Returns the incoming X-Request-ID if strictly conforming to format, otherwise generates a secure UUID.
 */
export function resolveRequestId(incomingHeader?: string | null): string {
  if (incomingHeader && typeof incomingHeader === "string") {
    const trimmed = incomingHeader.trim();
    if (ALLOWED_REQUEST_ID_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return crypto.randomUUID();
}

/**
 * Recursively sanitizes and redacts sensitive information from log payloads.
 */
export function sanitizeLogDetails(obj: unknown, depth = 0): unknown {
  if (depth > 5) return "[Truncated: Depth Limit]";
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Redact obvious secret patterns
    if (obj.startsWith("img_live_") || obj.startsWith("sk_live_") || obj.startsWith("sk_test_") || obj.startsWith("whsec_")) {
      return "[REDACTED_CREDENTIAL]";
    }
    if (obj.startsWith("postgres://") || obj.startsWith("postgresql://") || obj.startsWith("redis://") || obj.startsWith("rediss://")) {
      return "[REDACTED_CONNECTION_STRING]";
    }
    return obj.length > 500 ? obj.slice(0, 500) + "... [Truncated]" : obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 50).map((item) => sanitizeLogDetails(item, depth + 1));
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitizeLogDetails(value, depth + 1);
      }
    }
    return result;
  }

  return String(obj);
}

/**
 * Creates and formats a structured JSON log entry.
 */
function createStructuredLog(
  level: LogLevel,
  event: string,
  payload: LogPayload = {}
): StructuredLogEntry {
  const now = new Date().toISOString();
  const service = "image-api";
  const environment = process.env.NODE_ENV || "development";

  let traceId: string | undefined;
  let spanId: string | undefined;

  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const spanContext = activeSpan.spanContext();
      if (spanContext.traceId) traceId = spanContext.traceId;
      if (spanContext.spanId) spanId = spanContext.spanId;
    }
  } catch {
    // Graceful fallback if OpenTelemetry API context is unavailable
  }

  const sanitizedDetails = payload.details
    ? (sanitizeLogDetails(payload.details) as Record<string, unknown>)
    : undefined;

  return {
    timestamp: now,
    level,
    event,
    service,
    environment,
    requestId: payload.requestId,
    traceId,
    spanId,
    route: payload.route,
    method: payload.method,
    statusCode: payload.statusCode,
    durationMs: payload.durationMs,
    outcome: payload.outcome,
    errorCode: payload.errorCode,
    details: sanitizedDetails,
  };
}

/**
 * Structured Logger instance for production server-side observability.
 */
export const logger = {
  debug(event: string, payload?: LogPayload): void {
    if (process.env.NODE_ENV !== "production" || process.env.LOG_LEVEL === "debug") {
      const entry = createStructuredLog("debug", event, payload);
      console.debug(JSON.stringify(entry));
    }
  },

  info(event: string, payload?: LogPayload): void {
    const entry = createStructuredLog("info", event, payload);
    console.info(JSON.stringify(entry));
  },

  warn(event: string, payload?: LogPayload): void {
    const entry = createStructuredLog("warn", event, payload);
    console.warn(JSON.stringify(entry));
  },

  error(event: string, payload?: LogPayload): void {
    const entry = createStructuredLog("error", event, payload);
    console.error(JSON.stringify(entry));
  },
};
