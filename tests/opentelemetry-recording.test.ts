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
  sanitizeSpanAttributes,
  sanitizeException,
  ALLOWED_SPAN_ATTRIBUTES,
} from "@/lib/observability/tracer";
import { createStructuredLog } from "@/lib/observability/logger";

describe("OpenTelemetry Real In-Memory Exporter & Recording Span Tests", () => {
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

  it("proves spans are recording and export real parent/child spans with valid non-zero IDs", async () => {
    const result = await withSpan(
      "parent.operation",
      async (parentSpan) => {
        expect(parentSpan.isRecording()).toBe(true);

        const childResult = await withSpan(
          "child.operation",
          async (childSpan) => {
            expect(childSpan.isRecording()).toBe(true);
            childSpan.setAttribute("http.status_code", 200);
            return 42;
          },
          { "http.method": "POST", "http.route": "/v1/images/transform" }
        );

        parentSpan.setAttribute("billing.operation", "test_billing");
        return childResult;
      },
      { "http.route": "/v1/images/transform" }
    );

    expect(result).toBe(42);

    const exportedSpans = exporter.getFinishedSpans();
    expect(exportedSpans.length).toBe(2);

    const childSpan = exportedSpans.find((s) => s.name === "child.operation");
    const parentSpan = exportedSpans.find((s) => s.name === "parent.operation");

    expect(childSpan).toBeDefined();
    expect(parentSpan).toBeDefined();

    // Check valid non-zero hex IDs
    expect(parentSpan!.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parentSpan!.spanContext().traceId).not.toBe("00000000000000000000000000000000");
    expect(parentSpan!.spanContext().spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(parentSpan!.spanContext().spanId).not.toBe("0000000000000000");

    // Parent/child relationship
    expect(childSpan!.spanContext().traceId).toBe(parentSpan!.spanContext().traceId);
    const parentId = (childSpan as any).parentSpanContext?.spanId || (childSpan as any).parentSpanId;
    expect(parentId).toBe(parentSpan!.spanContext().spanId);
  });

  it("strictly enforces attribute allowlist and rejects forbidden/sensitive attributes", () => {
    const rawAttrs = {
      "http.method": "POST",
      "http.route": "/v1/images/transform",
      "image.output_format": "webp",
      "user_email": "attacker@example.com",
      "authorization": "Bearer img_live_secret123",
      "database_url": "postgres://user:pass@host/db",
      "api_key": "img_live_1234567890",
      "secret_token": "sk_test_123456",
      "cookie_session": "session=xyz123",
      "unvetted_custom_attr": "value",
    };

    const sanitized = sanitizeSpanAttributes(rawAttrs as any);

    // Allowed attributes must be present
    expect(sanitized["http.method"]).toBe("POST");
    expect(sanitized["http.route"]).toBe("/v1/images/transform");
    expect(sanitized["image.output_format"]).toBe("webp");

    // Forbidden attributes must be absent
    expect(sanitized["user_email"]).toBeUndefined();
    expect(sanitized["authorization"]).toBeUndefined();
    expect(sanitized["database_url"]).toBeUndefined();
    expect(sanitized["api_key"]).toBeUndefined();
    expect(sanitized["secret_token"]).toBeUndefined();
    expect(sanitized["cookie_session"]).toBeUndefined();
    expect(sanitized["unvetted_custom_attr"]).toBeUndefined();

    // Verify every key in sanitized output is in ALLOWED_SPAN_ATTRIBUTES
    for (const key of Object.keys(sanitized)) {
      expect(ALLOWED_SPAN_ATTRIBUTES.has(key)).toBe(true);
    }
  });

  it("records sanitized exceptions on error spans and rejects sensitive error messages", async () => {
    class DatabaseConnectionError extends Error {
      readonly code = "POSTGRES_CONNECTION_ERROR";
      constructor(message: string) {
        super(message);
        this.name = "DatabaseConnectionError";
      }
    }

    const sensitiveError = new DatabaseConnectionError(
      "Connection failed to postgres://user:super_secret_pw@db.neon.tech/main"
    );

    const sanitized = sanitizeException(sensitiveError) as Error;
    expect(sanitized.name).toBe("DatabaseConnectionError");
    // Raw database URL with password must not be in the exception message
    expect(sanitized.message).not.toContain("super_secret_pw");
    expect(sanitized.message).toBe("POSTGRES_CONNECTION_ERROR");

    await expect(
      withSpan("failing.operation", async () => {
        throw sensitiveError;
      })
    ).rejects.toThrow();

    const exportedSpans = exporter.getFinishedSpans();
    expect(exportedSpans.length).toBe(1);

    const failedSpan = exportedSpans[0];
    expect(failedSpan.status.code).toBe(2); // SpanStatusCode.ERROR = 2
    expect(failedSpan.events.length).toBeGreaterThanOrEqual(1);

    const exceptionEvent = failedSpan.events.find((e) => e.name === "exception");
    expect(exceptionEvent).toBeDefined();
    expect(exceptionEvent!.attributes?.["exception.message"]).not.toContain("super_secret_pw");
  });

  it("proves structured log entries correlate with active OpenTelemetry trace ID and span ID", async () => {
    await withSpan("traced.route", async (span) => {
      const activeTraceId = span.spanContext().traceId;
      const activeSpanId = span.spanContext().spanId;

      const logEntry = createStructuredLog("info", "test.event", {
        route: "/v1/images/transform",
        method: "POST",
      });

      expect(logEntry.traceId).toBe(activeTraceId);
      expect(logEntry.spanId).toBe(activeSpanId);
      expect(logEntry.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(logEntry.spanId).toMatch(/^[0-9a-f]{16}$/);
    });
  });
});
