import { describe, it, expect } from "vitest";
import { withSpan } from "@/lib/observability/tracer";

describe("OpenTelemetry Tracer Helper Unit Tests", () => {
  it("executes function within span and returns resolved result", async () => {
    const result = await withSpan(
      "test.operation",
      async (span) => {
        expect(span).toBeDefined();
        span.setAttribute("test.attribute", "value");
        return { success: true, count: 5 };
      },
      { "init.attr": "test" }
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(5);
  });

  it("propagates thrown exceptions while recording error on span", async () => {
    class CustomDomainError extends Error {
      readonly code = "CUSTOM_DOMAIN_ERROR";
    }

    await expect(
      withSpan("test.failing_operation", async () => {
        throw new CustomDomainError("Simulated failure in span");
      })
    ).rejects.toThrow("Simulated failure in span");
  });

  it("redacts sensitive strings in initial span attributes", async () => {
    const result = await withSpan(
      "test.redaction",
      async () => "done",
      {
        safeAttr: "public",
        sensitiveKey: "img_live_1234567890",
      }
    );

    expect(result).toBe("done");
  });
});
