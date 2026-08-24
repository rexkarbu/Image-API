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

const SENSITIVE_KEY_REGEX = /(?:key|secret|token|auth|cookie|password|database|redis|stripe|conn|url|cert|signature|payload|body|image|card|email|session|idempotency)/i;
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
 * Redacts known sensitive patterns embedded anywhere inside a string.
 */
export function redactSensitiveString(value: string): string {
  if (!value || typeof value !== "string") return value;

  let result = value;

  // 1. Bearer / Authorization headers
  result = result.replace(/Authorization:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer [REDACTED]");
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");

  // 2. API Keys and Stripe secrets anywhere in string
  result = result.replace(/img_live_[A-Za-z0-9_-]+/g, "[REDACTED_CREDENTIAL]");
  result = result.replace(/sk_(?:test|live)_[A-Za-z0-9]+/g, "[REDACTED_CREDENTIAL]");
  result = result.replace(/whsec_[A-Za-z0-9]+/g, "[REDACTED_CREDENTIAL]");

  // 3. Database and Redis connection strings
  result = result.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_CONNECTION_STRING]");
  result = result.replace(/redis(?:s)?:\/\/[^\s"']+/gi, "[REDACTED_CONNECTION_STRING]");

  // 4. URLs with embedded credentials (user:pass@host)
  result = result.replace(/https?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi, "[REDACTED_URL]");

  // 5. Emails
  result = result.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]");

  // 6. Session and cookie tokens
  result = result.replace(/(?:session|token|auth)=[^;\s]+/gi, "[REDACTED_COOKIE]");

  // 7. Long 64-char hex strings (raw hashes / keys)
  result = result.replace(/\b[0-9a-f]{64}\b/gi, "[REDACTED_HASH]");

  return result.length > 500 ? result.slice(0, 500) + "... [Truncated]" : result;
}

/**
 * Recursively sanitizes and redacts sensitive information from log payloads.
 */
export function sanitizeLogDetails(obj: unknown, depth = 0): unknown {
  if (depth > 5) return "[Truncated: Depth Limit]";
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return redactSensitiveString(obj);
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

  return redactSensitiveString(String(obj));
}

/**
 * Creates and formats a structured JSON log entry.
 */
export function createStructuredLog(
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
      if (spanContext.traceId && !/^0+$/.test(spanContext.traceId)) {
        traceId = spanContext.traceId;
      }
      if (spanContext.spanId && !/^0+$/.test(spanContext.spanId)) {
        spanId = spanContext.spanId;
      }
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
