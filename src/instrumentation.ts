export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // OpenTelemetry tracer initialized under service "image-api"
    const { logger } = await import("@/lib/observability/logger");
    logger.info("server.instrumentation_ready", {
      details: {
        runtime: "nodejs",
        service: "image-api",
      },
    });
  }
}
