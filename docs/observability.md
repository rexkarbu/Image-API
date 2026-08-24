# Observability & Structured Logging Architecture

## Overview

Image API implements enterprise-grade, privacy-safe observability designed for zero-trust multi-tenant environments. The observability layer consists of:

1. **Structured JSON Logging**: Standardized, machine-readable log lines with strict field allowlists and automatic recursive secret redaction.
2. **OpenTelemetry Distributed Tracing**: Low-cardinality span instrumentation mapping request lifecycles across API authentication, rate limiting, multipart processing, Sharp transformation, database metering, and Stripe Billing.
3. **Request Correlation**: Cryptographically secure, format-validated `X-Request-ID` tracking linking edge gateways, Route Handlers, database operations, and logs.

---

## 1. Structured Logging Schema

All server-side logs are output as single-line JSON objects with allowlisted fields:

```typescript
interface StructuredLogEntry {
  timestamp: string;      // ISO 8601 UTC timestamp (e.g. "2026-08-24T12:00:00.000Z")
  level: LogLevel;        // "debug" | "info" | "warn" | "error"
  event: string;          // Dot-notated domain event (e.g. "transform.completed")
  service: string;        // "image-api"
  environment: string;    // "production" | "preview" | "development"
  requestId?: string;     // Resolved request correlation identifier
  traceId?: string;       // Active OpenTelemetry trace ID (if available)
  spanId?: string;        // Active OpenTelemetry span ID (if available)
  route?: string;         // Canonical route template (e.g. "/v1/images/transform")
  method?: string;        // HTTP verb ("POST", "GET", etc.)
  statusCode?: number;    // HTTP response status code (e.g. 200, 401, 429)
  durationMs?: number;    // Measured execution latency in milliseconds
  outcome?: LogOutcome;   // "success" | "failure" | "error" | "rate_limited" | "unauthorized" | "rejected"
  errorCode?: string;     // Stable domain error code (e.g. "DUPLICATE_REQUEST")
  details?: Record<string, unknown>; // Allowlisted, sanitized context object
}
```

### Log Levels
- **`debug`**: Verbose internal diagnostics (disabled in production unless `LOG_LEVEL=debug`).
- **`info`**: Request completion, successful billing batch reports, scheduled job summaries.
- **`warn`**: Recoverable operational anomalies (client 4xx errors, rate limits, worker lease busy).
- **`error`**: Unhandled exceptions, infrastructure outages (5xx errors, database connectivity failures).

### Strict Redaction Guarantees
- The logging subsystem runs recursive redaction on all payloads.
- Keys matching sensitive substrings (`key`, `secret`, `token`, `auth`, `cookie`, `password`, `database`, `redis`, `conn`, `url`, `cert`, `signature`, `payload`, `body`, `image`, `card`, `email`) are replaced with `"[REDACTED]"`.
- Values matching known credential prefixes (`img_live_`, `sk_live_`, `sk_test_`, `whsec_`) are replaced with `"[REDACTED_CREDENTIAL]"`.
- PostgreSQL and Redis connection URIs are replaced with `"[REDACTED_CONNECTION_STRING]"`.
- Raw request bodies, multipart buffers, uploaded image binaries, and user passwords are **never logged under any circumstance**.

---

## 2. Request Correlation & `X-Request-ID`

- Inbound requests may provide an `X-Request-ID` header.
- The server validates the header against `^[A-Za-z0-9._:-]{1,128}$`.
- If the header is missing, malformed, or exceeds 128 characters, the server automatically generates a secure `crypto.randomUUID()`.
- Every HTTP response unconditionally returns the validated/generated `X-Request-ID` header.
- The Request ID is strictly used for logging and diagnostic correlation; it is never trusted for authentication or tenancy resolution.

---

## 3. OpenTelemetry Distributed Tracing

The application initializes an OpenTelemetry tracer under service name `image-api`.

### Registered Spans
| Span Name | Covered Operation | Low-Cardinality Attributes |
| :--- | :--- | :--- |
| `image_transform.pipeline` | Entire `POST /v1/images/transform` route | `http.method`, `http.route`, `image.output_format`, `image.width`, `image.height` |
| `api.authenticate` | API key verification & database lookup | `auth.status` |
| `rate_limit.evaluate` | Upstash Redis token bucket evaluation | `rate_limit.scope` |
| `multipart.parse` | Busboy streaming multipart parsing | `multipart.field_count` |
| `image.transform` | Sandboxed Sharp image resizing/encoding | `image.target_format` |
| `usage.persist` | Immutable PostgreSQL `usage_events` write | `db.table` |
| `billing.webhook.record`| Stripe webhook verification & inbox write | `http.method`, `http.route` |
| `billing.cron.run` | Billing worker trigger endpoint | `http.method`, `http.route` |
| `billing.worker.run` | Background usage aggregation & claiming | `billing.operation` |
| `billing.meter.report` | Stripe Billing Meter Event submission | `billing.batch_id`, `billing.units` |
| `billing.reconcile` | Usage reconciliation run | `billing.organization_id`, `billing.reconcile_status` |
| `health.ready` | Request-path readiness probe | `health.database`, `health.redis`, `health.status` |

---

## 4. OTLP Exporter Configuration

In production or preview environments, standard OpenTelemetry environment variables can be provided:
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Collector endpoint (e.g. `https://otlp.datadoghq.com` or custom gateway).
- `OTEL_EXPORTER_OTLP_HEADERS`: Authorization headers for the OTLP collector.

If no OTLP collector is configured, the tracer operates as a no-op / local in-memory trace context provider without raising runtime errors.
