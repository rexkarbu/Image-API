# Image API (Temporary Working Title)

Usage-based developer platform for image resizing, format conversion, and optimization.

## Current Milestone Status

**Milestone 0 — Project Foundation, Auth, Database, and Multi-Tenancy** (Completed)
- **M0.1**: Upgraded to Next.js 16.3.2, ESLint Flat Config, patched Drizzle ORM security release, and enforced secure foreign-key delete actions (`CASCADE` / `RESTRICT` / `SET NULL`).
- **M0.2**: Live PostgreSQL integration with Neon (pooled runtime + direct migration connections), Better Auth session/auth lifecycle verified E2E, and guarded live integration test suite.
- **M0.3**: Pinned development database endpoint ID, centralized fail-closed development-safety guard, direct-only migration runner, and assertion-based schema verifier.

**Milestone 1 — Secure API-Key Lifecycle** (Completed)
- Cryptographic key generation with SHA-256 hashing at rest (`img_live_<43 chars base64url>`).
- One-time reveal modal and secure display prefix indexing (`img_live_ab12cd34••••••••`).
- Tenant-scoped API key management dashboard (`/dashboard/api-keys` with status filtering).
- Safe key rotation with immediate invalidation or 24-hour transition grace period.
- Append-only `api_key_audit_events` tracking creation, rotation, and revocation.
- Server-only API key verification foundation with throttled `last_used_at` writes.

**Milestone 2 — Image Transformation Endpoint & Accurate Usage Metering** (Completed)
- Public API route handler `POST /v1/images/transform` running on Node.js runtime with `maxDuration = 30`.
- Bearer API key authentication (`Authorization: Bearer img_live_...`) with indistinguishable 401 rejection.
- Streaming multipart/form-data parsing with Busboy enforcing 10 MiB payload limits, strict field validation, and file chunk buffering.
- Sharp sandboxed image processing: automatic EXIF stripping, auto-orientation (`.rotate()`), dimension limits (max 4096x4096), input format gating (JPEG, PNG, WebP), and output encoding (JPEG with mozjpeg & alpha flattening, PNG lossless, WebP, AVIF).
- Explicit `Idempotency-Key` header enforcement (16-128 visible ASCII characters) converted to tenant-namespaced 64-character SHA-256 request IDs.
- Atomic append-only `usage_events` metering with PostgreSQL `ON CONFLICT (request_id) DO NOTHING` serialization: exactly 1 billable unit recorded only after successful transformation, returning 409 `DUPLICATE_REQUEST` on key reuse.
- Zero usage recorded on all failure paths (auth errors, invalid options, unsupported input, corrupt files).

**Milestone 3 — Developer Dashboard for Keys and Usage** (Completed)
- Server-only tenant analytics service (`src/lib/services/usage-analytics.ts`) enforcing strict `organization_id` scoping and UTC time-series bucketing.
- Dedicated usage dashboard page (`/dashboard/usage`) with real-time summary cards, interactive URL filters (24h, 7d, 30d, month, custom date range, API key, endpoint, status code), and tab-visibility auto-refresh (~30s).
- Accessible time-series data visualization with nonvisual table/summary fallback.
- Per-API-key usage breakdown with proportion calculation and masked prefix display.
- Append-only transformation event log with deterministic cursor-based pagination.
- Updated overview page (`/dashboard`) with live monthly consumption volume, active credentials, and truthful unconfigured quota state ("No quota configured").

**Milestone 4 — Distributed Rate Limiting & Abuse Protection** (Completed)
- Distributed, concurrency-safe rate limiting on Node.js runtime using `@upstash/redis` and `@upstash/ratelimit`.
- **Pre-Authentication IP Limiter**: Sliding window of 120 requests per 60 seconds per HMAC-derived client IP to protect Bearer auth and PostgreSQL from brute-force floods.
- **Authenticated API-Key Limiter**: Token bucket with 10 tokens refill per 10 seconds and maximum burst capacity of 20 tokens to protect Sharp, memory, and CPU resources.
- **Privacy-Preserving Identifiers**: Domain-separated HMAC-SHA-256 digests (`ip\0...` and `key\0...`) with zero plaintext IP addresses, API keys, key hashes, or database IDs stored in Redis.
- **Trusted Client-IP Resolution**: Resolves client IP defensively from `x-vercel-forwarded-for` in production on Vercel with strict `node:net` validation, failing closed with 503 if unavailable.
- **Fail-Closed Resilience**: Upstash timeouts (`reason === "timeout"`) and network outages immediately return sanitized `503 RATE_LIMIT_UNAVAILABLE` without leaking internals or falling back to unbounded execution.
- **HTTP Error Contract**: `429 RATE_LIMITED` returns standardized JSON payload, `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` Unix epoch headers.
- **Zero-Billing Guarantee**: Zero `usage_events` rows are recorded for rate-limited (429) or unavailable (503) attempts.
- **Live Redis Integration & HTTP E2E Suites**: Dedicated guarded runner (`pnpm test:redis-integration`) and full loopback verification (`pnpm verify:http`).

*Milestone 5 (Stripe Metered Billing & Reconciliation) is scheduled next.*

---

## Prerequisites

- **Node.js**: `>=20.9.0` (compatible with Node 20.x, 22.x, 24.x)
- **Package Manager**: `pnpm` (`>=9.0.0`)
- **Database**: PostgreSQL (`v15+`, developed against Neon Serverless PostgreSQL)
- **Distributed Cache / Rate Limiter**: Upstash Redis (REST-based)

---

## Release Safety Policy

Before any production deployment:
1. Verify the installed Next.js version (`16.3.2`) against the latest security advisories.
2. Run `pnpm audit --prod` to ensure zero unmitigated high/critical production vulnerabilities.
3. Rerun the full test suite (`pnpm test`), typecheck (`pnpm typecheck`), and build (`pnpm build`).

---

## Environment Setup

Copy `.env.example` to create your local `.env.local` file:

```bash
cp .env.example .env.local
```

### Environment Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL pooled connection string (runtime) | `postgres://user:pass@ep-xyz-pooler.region.neon.tech/neondb?sslmode=verify-full` |
| `DIRECT_DATABASE_URL` | PostgreSQL direct unpooled connection (migrations) | `postgres://user:pass@ep-xyz.region.neon.tech/neondb?sslmode=verify-full` |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth (min 32 chars) | `generate-using-crypto-random-32-bytes` |
| `BETTER_AUTH_URL` | Canonical Better Auth base URL | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Application public URL | `http://localhost:3000` |
| `DATABASE_ENV` | Environment marker (`development` \| `production`) | `development` |
| `DEVELOPMENT_DATABASE_ENDPOINT_ID` | Pinned Neon endpoint identifier for fail-closed dev safety | `ep-example-development` |
| `RUN_DB_INTEGRATION_TESTS` | Safety opt-in for live DB integration tests | `true` |
| `HTTP_E2E_BASE_URL` | Loopback base URL for real HTTP E2E testing | `http://127.0.0.1:3000` |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint | `https://example-endpoint.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST authentication token | `example-upstash-rest-token` |
| `RATE_LIMIT_IDENTIFIER_SECRET` | HMAC secret for rate limit identifier derivation (64 hex) | `generate-using-openssl-rand-hex-32` |
| `REDIS_ENV` | Redis environment marker (`development` \| `production`) | `development` |
| `DEVELOPMENT_REDIS_ENDPOINT_ID` | Pinned Upstash Redis endpoint identifier | `example-endpoint` |
| `RUN_REDIS_INTEGRATION_TESTS` | Safety opt-in for live Redis integration tests | `true` |

---

## Installation & Setup

1. **Install Dependencies**:
   ```bash
   pnpm install
   ```

2. **Generate Database Migrations**:
   ```bash
   pnpm db:generate
   ```

3. **Check Schema & Snapshot Consistency**:
   ```bash
   pnpm db:check
   ```

4. **Apply Database Migrations** (uses `DIRECT_DATABASE_URL`):
   ```bash
   pnpm db:migrate
   ```

5. **Smoke Test Database Connection**:
   ```bash
   pnpm db:smoke
   ```

6. **Verify Database Schema & Constraints**:
   ```bash
   pnpm db:verify
   ```

7. **Start Development Server**:
   ```bash
   pnpm dev
   ```

---

## Available Scripts

- `pnpm dev`: Runs Next.js development server on `http://localhost:3000`.
- `pnpm build`: Creates optimized production build.
- `pnpm start`: Runs production build.
- `pnpm lint`: Runs ESLint for Next.js and TypeScript rules.
- `pnpm typecheck`: Validates TypeScript strict typing without emitting files.
- `pnpm test`: Runs Vitest in-memory unit test suite (240 tests).
- `pnpm test:redis-integration`: Runs live Upstash Redis rate limiting integration tests (5 tests).
- `pnpm test:integration`: Runs full live PostgreSQL and Redis integration test suite (28 tests).
- `pnpm verify:http`: Runs real HTTP E2E verification of `POST /v1/images/transform` against running server.
- `pnpm db:generate`: Generates SQL migration files from Drizzle schema.
- `pnpm db:check`: Checks Drizzle schema snapshot consistency.
- `pnpm db:migrate`: Executes pending SQL migrations over direct connection.
- `pnpm db:smoke`: Validates live PostgreSQL connection and verifies all 9 tables.
- `pnpm db:verify`: Executes assertion-based metadata verification against live schema.
- `pnpm db:studio`: Opens Drizzle Studio for visual database inspection.

---

## Image Transformation API (`POST /v1/images/transform`)

### Request Headers
- `Authorization`: `Bearer img_live_<secret>` (Required)
- `Idempotency-Key`: `16-128 printable ASCII characters` (Required)
- `Content-Type`: `multipart/form-data` (Required)

### Multipart Form Fields
- `file`: Image binary data (Required; JPEG, PNG, or WebP up to 10 MiB)
- `width`: Integer `1-4096` (Optional)
- `height`: Integer `1-4096` (Optional)
- `format`: `jpeg` | `png` | `webp` | `avif` (Optional, default: `webp`)
- `quality`: Integer `1-100` (Optional, default: `80` for JPEG/WebP/AVIF; rejected if `format=png`)
- `fit`: `cover` | `contain` | `inside` | `fill` (Optional, default: `inside`)
- `withoutEnlargement`: `true` | `false` (Optional, default: `true`)

### Rate Limits & Headers
- **Pre-Auth IP Limit**: 120 requests / 60 seconds (Sliding Window)
- **Authenticated Key Limit**: 10 tokens refill / 10 seconds, burst capacity 20 tokens (Token Bucket)
- **Rate Limited Response (`429`)**:
  - `Retry-After`: Integer delta seconds (minimum 1)
  - `X-RateLimit-Limit`: Maximum bucket capacity
  - `X-RateLimit-Remaining`: Remaining tokens (`0`)
  - `X-RateLimit-Reset`: Unix epoch timestamp in seconds
  - `X-Request-ID`: Correlation ID
- **Success Response (`200`)**: Exposes authenticated API key's current quota headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`).

---

## What Is Intentionally Deferred (Out of Scope for M4)

The following features are intentionally not implemented yet and are scheduled for subsequent milestones:

- Stripe customer synchronization and metered billing reporting (Milestone 5).
- Dynamic tier-specific or paid subscription rate limits (Milestone 5).
- Background worker queues and async job dispatch.
- Multi-user invitations and team management.
- Email delivery provider integration for verification links.
- Social OAuth providers.
- OpenTelemetry observability and Grafana/Prometheus metrics (Milestone 6).
