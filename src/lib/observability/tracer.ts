import "server-only";
import { trace, Span as OtelSpan, SpanStatusCode, Exception } from "@opentelemetry/api";

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
  "billing.units",
  "billing.reconcile_status",
  "billing.difference",
  "health.database",
  "health.redis",
  "health.status",
  "error.type",
]);

const SENSITIVE_VALUE_REGEX = /(?:img_live_|sk_live_|sk_test_|whsec_|postgres(?:ql)?:\/\/|redis(?:s)?:\/\/|bearer\s+|password|token|secret|@|session|key|id_|org_|usr_|sub_|price_|mtr_)/i;
const ERROR_CODE_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Safe Span Facade preventing application code from accessing raw OpenTelemetry Span APIs
 * or attaching unvetted, high-cardinality, or sensitive attributes.
 */
export interface SafeSpan {
  setAttribute(key: string, value: string | number | boolean | undefined | null): void;
  setAttributes(attributes: Record<string, string | number | boolean | undefined | null>): void;
  isRecording(): boolean;
  spanContext(): { traceId: string; spanId: string };
}

/**
 * Creates a SafeSpan wrapper around a raw OpenTelemetry Span.
 */
export function createSafeSpan(rawSpan: OtelSpan): SafeSpan {
  return {
    setAttribute(key: string, value: string | number | boolean | undefined | null): void {
      if (value === undefined || value === null) return;
      if (!ALLOWED_SPAN_ATTRIBUTES.has(key)) return;

      if (typeof value === "number" || typeof value === "boolean") {
        rawSpan.setAttribute(key, value);
        return;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (SENSITIVE_VALUE_REGEX.test(trimmed)) return;
        const bounded = trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed;
        rawSpan.setAttribute(key, bounded);
      }
    },

    setAttributes(attributes: Record<string, string | number | boolean | undefined | null>): void {
      for (const [k, v] of Object.entries(attributes)) {
        this.setAttribute(k, v);
      }
    },

    isRecording(): boolean {
      return rawSpan.isRecording();
    },

    spanContext(): { traceId: string; spanId: string } {
      const ctx = rawSpan.spanContext();
      return {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
      };
    },
  };
}

/**
 * Retrieves the application OpenTelemetry tracer instance.
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Sanitizes an exception to ensure zero secrets or raw SQL/payloads leak into traces.
 */
export function sanitizeException(error: unknown): Exception {
  if (error instanceof Error) {
    const rawCode = (error as { code?: string })?.code || error.name || "Error";
    const safeCode = ERROR_CODE_REGEX.test(rawCode) ? rawCode : "INTERNAL_ERROR";

    let safeMessage = error.message;
    if (SENSITIVE_VALUE_REGEX.test(safeMessage) || safeMessage.length > 200) {
      safeMessage = safeCode;
    }
    const safeError = new Error(safeMessage);
    safeError.name = error.name && error.name !== "Error" ? error.name : error.constructor?.name || "Error";
    return safeError;
  }

  return new Error("INTERNAL_ERROR");
}

/**
 * Normalizes an error code to a safe enum-style format (^[A-Z][A-Z0-9_]{0,63}$).
 */
export function normalizeErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && ERROR_CODE_REGEX.test(code)) {
      return code;
    }
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && ERROR_CODE_REGEX.test(name)) {
      return name;
    }
  }
  return "INTERNAL_ERROR";
}

/**
 * Executes a function within an OpenTelemetry active span using the SafeSpan facade.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: SafeSpan) => Promise<T>,
  attributes?: SpanAttributes
): Promise<T> {
  const tracer = getTracer();

  return tracer.startActiveSpan(name, async (rawSpan) => {
    const safeSpan = createSafeSpan(rawSpan);

    try {
      if (attributes) {
        safeSpan.setAttributes(attributes);
      }

      const result = await fn(safeSpan);
      rawSpan.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const normalizedCode = normalizeErrorCode(error);

      rawSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: normalizedCode,
      });

      // Record sanitized exception on the raw span
      rawSpan.recordException(sanitizeException(error));

      // Record low-cardinality error attribute
      rawSpan.setAttribute("error.type", normalizedCode);

      throw error;
    } finally {
      rawSpan.end();
    }
  });
}
