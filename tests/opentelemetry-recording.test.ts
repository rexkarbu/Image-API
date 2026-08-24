import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { trace, context } from "@opentelemetry/api";
import {
  withSpan,
  createSafeSpan,
  sanitizeException,
  normalizeErrorCode,
  ALLOWED_SPAN_ATTRIBUTES,
} from "@/lib/observability/tracer";
import { createStructuredLog } from "@/lib/observability/logger";

describe("OpenTelemetry SafeSpan Facade & Fail-Closed Observability Tests", () => {
  let provider: BasicTracerProvider;
  let exporter: InMemorySpanExporter;
  let contextManager: AsyncHooksContextManager;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    trace.setGlobalTracerProvider(provider);
  });

  afterEach(() => {
    exporter.reset();
    trace.disable();
    context.disable();
  });

  it("proves SafeSpan facade prevents direct raw span bypass and rejects unallowlisted/sensitive attributes", async () => {
    await withSpan("test.operation", async (safeSpan) => {
      // 1. Allowed attributes
      safeSpan.setAttribute("http.method", "POST");
      safeSpan.setAttribute("http.route", "/v1/images/transform");
      safeSpan.setAttribute("image.width", 800);
      safeSpan.setAttribute("image.height", 600);
      safeSpan.setAttribute("image.output_format", "webp");

      // 2. High-cardinality and forbidden attributes (MUST be rejected by facade)
      safeSpan.setAttribute("billing.organization_id", "org_987654321");
      safeSpan.setAttribute("billing.batch_id", "batch_123456789");
      safeSpan.setAttribute("user_email", "admin@enterprise.com");
      safeSpan.setAttribute("api_key", "img_live_super_secret_token_12345");
      safeSpan.setAttribute("authorization", "Bearer secret");
      safeSpan.setAttribute("stripe_customer_id", "cus_stripe_12345");
      safeSpan.setAttribute("unvetted_custom_field", "malicious_payload");
      safeSpan.setAttribute("database_url", "postgres://user:pass@host/db");
    });

    const finished = exporter.getFinishedSpans();
    expect(finished.length).toBe(1);

    const span = finished[0];
    const attrs = span.attributes;

    // Allowed attributes must be present
    expect(attrs["http.method"]).toBe("POST");
    expect(attrs["http.route"]).toBe("/v1/images/transform");
    expect(attrs["image.width"]).toBe(800);
    expect(attrs["image.height"]).toBe(600);
    expect(attrs["image.output_format"]).toBe("webp");

    // All forbidden / high-cardinality attributes must be absent from underlying span
    expect(attrs["billing.organization_id"]).toBeUndefined();
    expect(attrs["billing.batch_id"]).toBeUndefined();
    expect(attrs["user_email"]).toBeUndefined();
    expect(attrs["api_key"]).toBeUndefined();
    expect(attrs["authorization"]).toBeUndefined();
    expect(attrs["stripe_customer_id"]).toBeUndefined();
    expect(attrs["unvetted_custom_field"]).toBeUndefined();
    expect(attrs["database_url"]).toBeUndefined();

    // Verify all keys on the exported span belong to ALLOWED_SPAN_ATTRIBUTES
    for (const key of Object.keys(attrs)) {
      expect(ALLOWED_SPAN_ATTRIBUTES.has(key)).toBe(true);
    }
  });

  it("proves parent/child spans export with valid non-zero IDs and proper linkage", async () => {
    const result = await withSpan("parent.op", async (parentSpan) => {
      expect(parentSpan.isRecording()).toBe(true);

      const childRes = await withSpan("child.op", async (childSpan) => {
        expect(childSpan.isRecording()).toBe(true);
        childSpan.setAttribute("http.status_code", 200);
        return 100;
      });

      return childRes;
    });

    expect(result).toBe(100);

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(2);

    const parent = spans.find((s) => s.name === "parent.op");
    const child = spans.find((s) => s.name === "child.op");

    expect(parent).toBeDefined();
    expect(child).toBeDefined();

    expect(parent!.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parent!.spanContext().traceId).not.toBe("00000000000000000000000000000000");
    expect(parent!.spanContext().spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parent!.spanContext().spanId).not.toBe("0000000000000000");

    expect(child!.spanContext().traceId).toBe(parent!.spanContext().traceId);
    const parentSpanId = (child as any).parentSpanContext?.spanId || (child as any).parentSpanId;
    expect(parentSpanId).toBe(parent!.spanContext().spanId);
  });

  it("normalizes error codes and sanitizes exception recording without secret leaks", async () => {
    class CustomDatabaseError extends Error {
      readonly code = "POSTGRES_TIMEOUT";
      constructor(msg: string) {
        super(msg);
        this.name = "CustomDatabaseError";
      }
    }

    const errorWithSecret = new CustomDatabaseError(
      "Query failed on postgres://postgres:SecretPassword123@db.neon.tech/main?sslmode=verify-full"
    );

    expect(normalizeErrorCode(errorWithSecret)).toBe("POSTGRES_TIMEOUT");
    expect(normalizeErrorCode("arbitrary thrown string")).toBe("INTERNAL_ERROR");

    const sanitized = sanitizeException(errorWithSecret) as Error;
    expect(sanitized.name).toBe("CustomDatabaseError");
    expect(sanitized.message).not.toContain("SecretPassword123");
    expect(sanitized.message).toBe("POSTGRES_TIMEOUT");

    await expect(
      withSpan("failing.step", async () => {
        throw errorWithSecret;
      })
    ).rejects.toThrow();

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBe(1);

    const failedSpan = spans[0];
    expect(failedSpan.status.code).toBe(2); // SpanStatusCode.ERROR = 2
    expect(failedSpan.status.message).toBe("POSTGRES_TIMEOUT");
    expect(failedSpan.attributes["error.type"]).toBe("POSTGRES_TIMEOUT");

    const exEvent = failedSpan.events.find((e) => e.name === "exception");
    expect(exEvent).toBeDefined();
    expect(exEvent!.attributes?.["exception.message"]).not.toContain("SecretPassword123");
  });

  it("proves structured log entries correlate with active OpenTelemetry trace ID and span ID", async () => {
    await withSpan("traced.execution", async (span) => {
      const { traceId, spanId } = span.spanContext();

      const logEntry = createStructuredLog("info", "test.correlated_event", {
        route: "/v1/images/transform",
        method: "POST",
      });

      expect(logEntry.traceId).toBe(traceId);
      expect(logEntry.spanId).toBe(spanId);
      expect(logEntry.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(logEntry.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
