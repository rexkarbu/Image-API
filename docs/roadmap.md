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

- [ ] **Milestone 3: Developer Dashboard for Keys and Usage**
  - Real-time usage event stream visualization.
  - Filter by date range, API key, and endpoint status.
  - Usage aggregations and quota summaries.

- [ ] **Milestone 4: Rate Limiting & Abuse Protection**
  - Token bucket / sliding window rate limiting.
  - Key-level and IP-level throttling.
  - HTTP 429 response formatting with retry-after headers.

- [ ] **Milestone 5: Stripe Metered Billing & Reconciliation**
  - Stripe Customer and Subscription creation on organization onboarding.
  - Background worker for usage aggregation and Stripe Usage Record reporting.
  - Usage reconciliation, invoice generation, and billing portal.

- [ ] **Milestone 6: Observability, Production Hardening, and Documentation Portal**
  - Structured request logging and OpenTelemetry tracing.
  - Interactive OpenAPI / Swagger developer documentation.
  - Health checks, alerts, and production deployment scripts.
