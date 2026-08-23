# Engineering Roadmap

- [x] **Milestone 0: Foundation, Auth, Database, and Multi-Tenancy**
  - **M0.0**: Next.js App Router scaffolding, strict TypeScript, Zod environment validation, PostgreSQL Drizzle schema, Better Auth email/password authentication, organization onboarding, and foundational unit test suite.
  - **M0.1**: Upgraded framework to Next.js 16.3.2, ESLint Flat Config, patched Drizzle ORM security release, and enforced intentional foreign-key delete actions (`CASCADE` / `RESTRICT` / `SET NULL`).
  - **M0.2**: Live PostgreSQL integration with Neon (pooled runtime + direct migration connections), Better Auth session/auth lifecycle verified E2E, and guarded live integration test suite.
  - **M0.3**: Exact development database endpoint pinning, centralized fail-closed development-safety guard, strict direct-only migration runner, and assertion-based schema metadata verification.

- [x] **Milestone 1: Secure API-Key Lifecycle**
  - Cryptographic API key generation with SHA-256 hashing (`img_live_<43 chars base64url>`).
  - One-time key reveal modal and secure prefix indexing (`img_live_ab12cd34••••••••`).
  - Tenant-scoped key management UI (`/dashboard/api-keys` with status filters: all, active, expired, revoked).
  - Secret key masking, last-used tracking, and idempotent revocation.
  - Atomic key rotation with immediate revocation or 24-hour transition grace period.
  - Append-only `api_key_audit_events` stream tracking creation, rotation, and revocation.
  - Server-only API key verification foundation.

- [x] **Milestone 2: Image Transformation Endpoint & Accurate Usage Recording**
  - Public route handler `POST /v1/images/transform` with `runtime = "nodejs"`.
  - Machine-to-machine authentication via Bearer API keys (`Authorization: Bearer img_live_...`).
  - Streaming multipart/form-data parser using Busboy with strict size (10 MiB) and field limit gating.
  - Sandboxed Sharp transformation pipeline: auto-orientation, EXIF/GPS stripping, resizing with aspect-ratio preserving fit modes, alpha channel flattening, and multi-format encoding (JPEG, PNG, WebP, AVIF).
  - Tenant-namespaced SHA-256 idempotency key derivation with zero plaintext logging.
  - Atomic PostgreSQL `usage_events` recording with `ON CONFLICT (request_id) DO NOTHING` serialization and `409 DUPLICATE_REQUEST` rejection.
  - Zero billable usage on client disconnects and pipeline failure paths.

- [x] **Milestone 3: Developer Dashboard for Keys and Usage**
  - Server-only usage analytics service (`src/lib/services/usage-analytics.ts`) strictly scoped by verified `organization_id`.
  - Pure client-safe DTO module (`src/types/usage.ts`) with zero database/auth/node dependencies.
  - Interactive URL searchParams filter normalization with preset ranges (`24h`, `7d`, `30d`, `month`, `custom` up to 90 days), API key filter, endpoint, and status code.
  - Deterministic time-series bucketing in UTC (hourly for <=48h, daily for >48h) with zero-filled missing buckets.
  - Truthful unconfigured monthly quota reporting (`No quota configured`).
  - Per-API-key usage breakdown with proportion calculation and masked prefix display (`img_live_ab12cd34••••••••`).
  - Append-only transformation event log with deterministic cursor-based pagination ordered by `created_at DESC, id DESC`.
  - Accessible SVG/CSS data visualization with accessible screen reader data tables.
  - Tab-visibility-aware auto-refresh (~30s) and manual refresh transitions.
  - Updated Overview page (`/dashboard`) with live monthly consumption volume, active credentials, and links to `/dashboard/usage`.

- [x] **Milestone 4: Rate Limiting & Abuse Protection**
  - Distributed, concurrency-safe rate limiting on Node.js runtime using `@upstash/redis` and `@upstash/ratelimit`.
  - Two independent distributed limiters:
    - **Pre-Authentication IP Limiter**: Sliding window of 120 req / 60s per HMAC-derived client IP (`image-api:ratelimit:ip:v1`).
    - **Authenticated API-Key Limiter**: Token bucket with 10 tokens refill per 10s and burst capacity 20 tokens (`image-api:ratelimit:key:v1`).
  - Privacy-preserving HMAC-SHA-256 identifier derivation with domain separation (`ip\0` vs `key\0`), storing zero plaintext IPs, keys, or IDs in Redis.
  - Trusted client-IP resolution from `x-vercel-forwarded-for` in production with strict `node:net` validation, failing closed with 503 if unavailable.
  - Fail-closed Redis resilience converting Upstash timeouts and network failures to sanitized `503 RATE_LIMIT_UNAVAILABLE`.
  - Standardized HTTP `429 RATE_LIMITED` response with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.
  - Exact route sequence: IP Limiter -> Bearer Auth -> Key Limiter -> Idempotency -> Multipart Ingestion -> Sharp Processing -> Usage Metering.
  - Zero `usage_events` recorded on rate-limited (429) or limiter unavailable (503) requests.
  - Guarded live Redis integration tests (`pnpm test:redis-integration`) and full real HTTP E2E verification (`pnpm verify:http`).

- [ ] **Milestone 5: Stripe Metered Billing & Reconciliation**
  - Stripe Customer and Subscription creation on organization onboarding.
  - Background worker for usage aggregation and Stripe Usage Record reporting.
  - Usage reconciliation, invoice generation, and billing portal.

- [ ] **Milestone 6: Observability, Production Hardening, and Documentation Portal**
  - Structured request logging and OpenTelemetry tracing.
  - Interactive OpenAPI / Swagger developer documentation.
  - Health checks, alerts, and production deployment scripts.
