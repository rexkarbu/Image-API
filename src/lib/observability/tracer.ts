import "server-only";
import { trace, Span, SpanStatusCode, Attributes, Exception } from "@opentelemetry/api";

const TRACER_NAME = "image-api";
const TRACER_VERSION = "0.1.0";

export const ALLOWED_SPAN_ATTRIBUTES = new Set([
  "http.method",
  "http.route",
  "http.status_code",
  "image.target_format",
  "image.output_format",
  "image.width",
  "image.height",
  "image.size_bytes",
  "billing.operation",
  "billing.batch_id",
  "billing.units",
  "billing.reconcile_status",
  "billing.difference",
  "health.database",
  "health.redis",
  "health.status",
  "error.type",
]);

const SENSITIVE_VALUE_REGEX = /(?:img_live_|sk_live_|sk_test_|whsec_|postgres(?:ql)?:\/\/|redis(?:s)?:\/\/|bearer\s+|password|token|secret|@)/i;

/**
 * Retrieves the application OpenTelemetry tracer instance.
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Filter and sanitize span attributes against a strict allowlist and sensitive content check.
 * Rejects high-cardinality / sensitive attributes (keys, tokens, emails, hashes, raw bodies, connection strings).
 */
export function sanitizeSpanAttributes(attributes?: SpanAttributes): Attributes {
  if (!attributes) return {};
  const sanitized: Attributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;

    // Strict allowlist validation
    if (!ALLOWED_SPAN_ATTRIBUTES.has(key)) {
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === "string") {
      // Reject empty or whitespace-only
      const trimmed = value.trim();
      if (!trimmed) continue;

      // Reject sensitive substrings
      if (SENSITIVE_VALUE_REGEX.test(trimmed)) {
        continue;
      }

      // Enforce bounded string length (max 128 chars)
      sanitized[key] = trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed;
    }
  }

  return sanitized;
}

/**
 * Sanitizes an exception to ensure zero secrets or raw SQL/payloads leak into traces.
 */
export function sanitizeException(error: unknown): Exception {
  if (error instanceof Error) {
    const code = (error as { code?: string })?.code || error.name || "Error";
    // Check if error message contains sensitive tokens or URLs
    let safeMessage = error.message;
    if (SENSITIVE_VALUE_REGEX.test(safeMessage) || safeMessage.length > 200) {
      safeMessage = code;
    }
    const safeError = new Error(safeMessage);
    safeError.name = error.name && error.name !== "Error" ? error.name : error.constructor?.name || "Error";
    return safeError;
  }

  return new Error(typeof error === "string" ? error.slice(0, 100) : "UnknownError");
}

/**
 * Executes a function within an OpenTelemetry active span.
 * Records recording spans, sets sanitized attributes, captures sanitized exceptions, and closes span.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: SpanAttributes
): Promise<T> {
  const tracer = getTracer();

  return tracer.startActiveSpan(name, async (span) => {
    try {
      if (attributes) {
        span.setAttributes(sanitizeSpanAttributes(attributes));
      }

      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const errName = error instanceof Error ? error.name : "UnknownError";
      const errCode = (error as { code?: string })?.code || errName;

      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errCode,
      });

      // Record sanitized exception on the span
      span.recordException(sanitizeException(error));

      // Record low-cardinality error attribute
      span.setAttribute("error.type", errCode.slice(0, 64));

      throw error;
    } finally {
      span.end();
    }
  });
}
