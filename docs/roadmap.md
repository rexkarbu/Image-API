# Engineering Roadmap

- [x] **Milestone 0: Foundation, Auth, Database, and Multi-Tenancy**
  - Next.js App Router scaffolding with TypeScript strict mode.
  - Typed server-only environment validation with Zod.
  - PostgreSQL schema and Drizzle ORM setup.
  - Better Auth email/password authentication with Drizzle adapter.
  - Organization & membership data model with atomic onboarding flow.
  - Multi-tenant data access helpers and security invariant enforcement.
  - Protected developer dashboard shell with real foundational metadata.
  - Foundational unit test suite and initial migration generation.

- [ ] **Milestone 1: Secure API-Key Lifecycle**
  - Cryptographic API key generation with SHA-256 hashing.
  - One-time key reveal modal and secure prefix indexing (`img_live_...`).
  - Key management UI (list, revoke, status filtering).
  - Secret key masking and last-used tracking.

- [ ] **Milestone 2: Image Transformation Endpoint & Accurate Usage Recording**
  - Binary image processing with `sharp` (resize, convert, compress).
  - Multipart upload parsing on Node.js runtime.
  - Authentication middleware validating hashed API key.
  - Atomic, idempotent `usage_events` recording with unique `request_id`.

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
