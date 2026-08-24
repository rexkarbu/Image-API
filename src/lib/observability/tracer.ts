import "server-only";
import { trace, Span, SpanStatusCode, Attributes } from "@opentelemetry/api";

const TRACER_NAME = "image-api";
const TRACER_VERSION = "0.1.0";

/**
 * Retrieves the application OpenTelemetry tracer instance.
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Filter and sanitize low-cardinality span attributes.
 * Rejects high-cardinality / sensitive attributes (keys, tokens, emails, hashes, raw bodies).
 */
function sanitizeSpanAttributes(attributes?: SpanAttributes): Attributes {
  if (!attributes) return {};
  const sanitized: Attributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    // Allow only safe primitive types
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      // Guard against accidental sensitive strings
      if (typeof value === "string" && (value.startsWith("img_") || value.startsWith("sk_") || value.startsWith("whsec_"))) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = value;
      }
    }
  }

  return sanitized;
}

/**
 * Executes a function within an OpenTelemetry active span.
 * Gracefully handles spans, records exceptions with sanitized error names, and ensures the span is closed.
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

      // Record low-cardinality error attribute
      span.setAttribute("error.type", errCode);

      throw error;
    } finally {
      span.end();
    }
  });
}
