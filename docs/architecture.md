# Architecture Documentation

## 1. High-Level Product Architecture

`Image API` is a SaaS platform providing usage-based image processing for developer applications.

```
+-----------------------------------------------------------------------------------+
|                                 Client Requests                                   |
+-----------------------------------------------------------------------------------+
        |                                                           |
        v (Web Browser)                                             v (API Clients)
+-------------------------------+                           +-----------------------+
|     Developer Dashboard       |                           |  Image API Endpoint   |
|   (/dashboard, /onboarding)   |                           | (/v1/images/transform)|
+-------------------------------+                           +-----------------------+
        |                                                           |
        | [Cookie Session: Better Auth]                             | 1. IP Rate Limiter [Upstash]
        v                                                           | 2. Bearer Key [SHA-256]
+-------------------------------+                           | 3. Key Rate Limiter [Upstash]
|     Next.js App Server        |                           v
|   (Server Components/Auth)    |                   +-------------------------------+
+-------------------------------+                   |     Node.js Processing        |
        |                                           |     (Sharp / Transform)       |
        | Tenant-Scoped DB Query                    +-------------------------------+
        v                                                           |
+---------------------------------------------------+       | Record Usage Event
|        PostgreSQL Database (Drizzle ORM)          |<------+
|  - user / session / account                       |
|  - organizations / organization_members           |
|  - api_keys (hashed SHA-256)                      |
|  - usage_events (append-only immutable stream)    |
+---------------------------------------------------+
```

---

## 2. Authentication Models

### Dashboard Authentication (Interactive Session)
- Built using **Better Auth** with the official **Drizzle Adapter** on PostgreSQL.
- Authenticates users via email and password for MVP.
- Issues secure HTTP-only cookies with server-side session lookup.
- Protects administrative routes and onboarding logic on the server prior to data access.

### API Consumer Authentication (Machine-to-Machine)
- Inbound API requests present Bearer tokens in the format `img_live_<base64url-secret>`.
- **Entropy & Encoding**: 32 bytes of cryptographically secure random entropy (`crypto.randomBytes(32)`) encoded as unpadded Base64URL (43 characters). Total key length: 52 characters.
- **SHA-256 at Rest**: Tokens are hashed using SHA-256 (stored as 64 lowercase hexadecimal characters) and matched against `api_keys.key_hash`.
- **Display Prefix**: The database stores `key_prefix` (e.g. `img_live_ab12cd34`) used for dashboard display (`img_live_ab12cd34••••••••`).
- **Zero Plaintext Persistence**: Plaintext keys are never stored in the database, cookies, browser storage, error messages, or logs.
- **One-Time Reveal**: Plaintext keys leave the server exactly once in the response of the creation/rotation Server Action.
- **Lifecycle & Audit**:
  - `api_keys` records: `active`, `expired` (derived when `expires_at <= now`), and `revoked`.
  - `api_key_audit_events`: Append-only audit stream tracking `created`, `revoked`, `rotation_created`, and `expiration_scheduled`.
  - **Rotation**: Supports `immediate` revocation or `grace_24h` transition (old key remains usable for 24 hours).
  - **Throttled Last Used**: Verification updates `last_used_at` at most once every 5 minutes to prevent write amplification.

---

### Role-Based Access Control (RBAC) Matrix
| Operation | `owner` | `admin` | `member` |
| :--- | :---: | :---: | :---: |
| **List API Key Metadata** | Allowed | Allowed | Allowed (Read-only) |
| **Create Secret Key** | Allowed | Allowed | Denied (`403 Forbidden`) |
| **Rotate Secret Key** | Allowed | Allowed | Denied (`403 Forbidden`) |
| **Revoke Secret Key** | Allowed | Allowed | Denied (`403 Forbidden`) |

---

## 3. Multi-Tenancy & Security Invariants

### Hard Tenant Security Invariant
> **Every query or mutation reading or writing organization-owned data MUST be explicitly scoped by `organization_id`.**

1. **Context Derivation**:
   - `requireUser()` derives the identity exclusively from the verified server-side session.
   - `requireOrganizationContext()` resolves the user's organization membership on the server.
   - User ID or Organization ID from browser input (query params, body, headers) is never trusted to identify the tenant.

2. **Scoped Operations**:
   - Repository helpers enforce `organization_id` filters across all read and write queries.
   - Generic lookups by record ID alone (e.g. `WHERE id = ?`) are strictly prohibited for tenant-owned tables (`api_keys`, `usage_events`).

---

## 4. Image Processing & Usage Metering Pipeline (Milestone 2)

### Endpoint Contract (`POST /v1/images/transform`)
- **Runtime**: Explicitly declared as `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `maxDuration = 30`.
- **Authentication**: Server-only helper `authenticateApiRequest` verifies the Bearer API key against the database, returning strictly indistinguishable `401 UNAUTHORIZED` responses with the uniform message `Invalid API credentials.` on all invalid, missing, expired, or revoked keys.
- **Idempotency & Request Isolation**:
  - `Idempotency-Key` header is required (16-128 printable ASCII characters without control characters or whitespace).
  - A tenant-namespaced 64-character SHA-256 digest is derived: `SHA-256(organizationId + "\0" + rawIdempotencyKey)`.
  - The raw user idempotency key is never persisted or logged.
- **Streaming Multipart Parser**:
  - Uses `busboy` on incoming request streams with zero temporary disk writes and explicit stream listener lifecycle cleanup.
  - Limits: max file size `10 MiB`, max text fields `6`, max files `1`, max accepted parts `7` (configured with `limits.parts: 8` as the sentinel to reject the 8th part when `++parts === limits.parts`), max field size `1024` bytes.
  - Validates options and rejects unknown/duplicate fields.
  - An explicitly supplied `fit` parameter is rejected with `400 INVALID_OPTIONS` unless both `width` and `height` dimensions are provided.
  - Rejects explicit `quality` parameter when `format = "png"` (PNG uses lossless compression).
- **Sharp Processing Sandboxing**:
  - Configured with `failOn: "warning"`, `limitInputPixels: 40_000_000`, `limitInputChannels: 4`, `pages: 1`, `animated: false`, and a 20-second timeout (`.timeout({ seconds: 20 })`).
  - Allowed input formats: `jpeg`, `png`, `webp` (rejects SVG, GIF, TIFF, PDF, AVIF input, and animated WebP).
  - Automatically strips all EXIF, GPS, XMP, and IPTC metadata.
  - Auto-orients based on EXIF (`.rotate()`) prior to resizing.
  - Flattens transparent alpha channels over solid white when converting to JPEG.
  - Output formats supported: JPEG (mozjpeg), PNG (lossless), WebP, AVIF.
  - Output bounds: max dimensions `4096x4096`, max output buffer `20 MiB`.
- **Atomic Usage Metering**:
  - Usage recording occurs strictly **after** successful image processing and verification that client is still connected (`!request.signal.aborted`).
  - Writes to `usage_events` with `units = 1`, `status_code = 200`, `endpoint = "/v1/images/transform"`.
  - Uses PostgreSQL `ON CONFLICT (request_id) DO NOTHING` to serialize concurrent requests: losing requests receive `409 DUPLICATE_REQUEST` without recording additional usage units.
  - All failure paths (400, 401, 413, 415, 422, 429, 500, 503) create **zero** usage event rows.

---

## 5. Usage Events & Billing Architecture

### Immutable Audit Log (`usage_events`)
- The `usage_events` table serves as the primary system of record for all metered activity.
- Every successful transformation creates an immutable event record containing:
  - `id` (UUID primary key)
  - `request_id` (64-character lowercase SHA-256 hex digest, unique)
  - `organization_id` (Tenant FK, ON DELETE RESTRICT)
  - `api_key_id` (API Key FK, ON DELETE RESTRICT)
  - `endpoint` (e.g. `/v1/images/transform`)
  - `units` (Check constraint: `units = 1`)
  - `status_code` (Check constraint: `200-299`)
  - `created_at` (Timestamp with timezone)

### Decoupled Metering & Async Billing
- **Request Path**: Synchronously records the event in PostgreSQL.
- **Billing Path**: Asynchronous batch aggregation for Stripe metered billing reconciliation in future milestones.

---

## 6. Developer Dashboard & Usage Analytics Architecture (Milestone 3 & M3.1)

### Server-Only Tenant Analytics
- Built in `src/lib/services/usage-analytics.ts` with explicit `import "server-only";` enforcement.
- Enforces strict tenant isolation: every query reading `usage_events` or joining `api_keys` is explicitly scoped by `organization_id` derived exclusively from `requireOrganizationContext()`.
- Explicit tenant join: `and(eq(usageEvents.apiKeyId, apiKeys.id), eq(apiKeys.organizationId, organizationId))` ensures cross-tenant API key metadata cannot cross the join boundary even in the event of foreign or corrupted key IDs.
- Parallel query execution (`Promise.all`) fetching period totals, current month volume, active API keys, latest event timestamps, UTC time series, and per-key breakdowns.

### Client-Safe Data Transfer Objects (DTOs)
- Centralized in `src/types/usage.ts` with zero database, authentication, or Node.js imports.
- Plain JavaScript objects containing stringified ISO timestamps in UTC.
- Key secrets and key hashes are strictly scrubbed, exposing only non-sensitive masked prefixes (`img_live_ab12cd34••••••••`).

### Date Range Normalization & Deterministic Bucketing
- Filter logic in `src/lib/validations/usage-filters.ts` normalizes URL search parameters into UTC timestamps with inclusive starts and exclusive ends `[start, end)`.
- Preset ranges supported: `24h`, `7d`, `30d`, `month` (calendar month-to-date), and `custom` (up to 90 days).
- Deterministic bucketing: Hourly intervals for spans <= 48 hours, daily intervals for spans > 48 hours.
- Bucket generator models half-open intervals `[start, end)` using `current < end` to prevent out-of-range trailing buckets.
- Missing time intervals are filled with 0 units in memory to guarantee continuous time-series visualization.

### Deterministic Cursor-Based Pagination
- Events queries are stably sorted by `usage_events.created_at DESC, usage_events.id DESC`.
- Opaque pagination cursor encodes `{ createdAt, id }` in Base64URL format.
- Queries with a cursor apply `(created_at < cursor.createdAt) OR (created_at = cursor.createdAt AND id < cursor.id)`, eliminating duplicate or skipped rows across identical millisecond timestamps.
- Cursors are strictly validated for length, Base64URL character set, exact 2-key JSON shape, canonical ISO timestamp, and valid ID format.

---

## 7. Distributed Rate Limiting & Abuse Protection Architecture (Milestone 4)

### Overview & Multi-Tier Throttling
To protect infrastructure from distributed denial-of-service, credential stuffing, compute exhaustion, and memory exhaustion, the transformation pipeline enforces two independent distributed rate limiters using Upstash REST-based Redis:

```
[Inbound HTTP Request]
       │
       ▼
1. Resolve Trusted Client IP (from x-vercel-forwarded-for)
       │
       ▼
2. Pre-Authentication IP Limiter (120 req / 60s, Sliding Window)
       │  └─► If exhausted: Return 429 RATE_LIMITED (Zero DB access)
       ▼
3. Authenticate Bearer API Key (PostgreSQL SHA-256 key_hash lookup)
       │  └─► If invalid: Return 401 UNAUTHORIZED (Indistinguishable)
       ▼
4. Authenticated API-Key Limiter (10 tokens / 10s, burst 20, Token Bucket)
       │  └─► If exhausted: Return 429 RATE_LIMITED (Zero Sharp / Multipart)
       ▼
5. Validate Idempotency & Duplicate Check (PostgreSQL)
       │
       ▼
6. Streaming Multipart Ingestion & Sandboxed Sharp Processing
       │
       ▼
7. Atomic Usage Metering (PostgreSQL ON CONFLICT)
       │
       ▼
8. Binary Output Response (with X-RateLimit-* headers)
```

### Rate Limiting Policies
1. **Pre-Authentication IP Limiter (`image-api:ratelimit:ip:v1`)**:
   - Algorithm: **Sliding Window** (120 requests per 60 seconds).
   - Purpose: Mitigates brute-force credential stuffing and protects database connection pools.
2. **Authenticated API-Key Limiter (`image-api:ratelimit:key:v1`)**:
   - Algorithm: **Token Bucket** (Refill rate: 10 tokens / 10s, Maximum burst capacity: 20 tokens).
   - Purpose: Prevents CPU and memory starvation by limiting compute-heavy Sharp transformations per organization credential.

### Privacy-Preserving HMAC Identifiers
- Identifiers stored in Redis are derived via **HMAC-SHA-256** using a server-only secret (`RATE_LIMIT_IDENTIFIER_SECRET`).
- Domain separation prevents cross-namespace collisions:
  - IP Identifier: `HMAC-SHA-256("ip\0" + normalizedClientIp)`
  - API-Key Identifier: `HMAC-SHA-256("key\0" + organizationId + "\0" + apiKeyId)`
- Redis receives only 64-character lowercase hexadecimal digests. Plaintext IP addresses, API keys, key hashes, and tenant IDs are **never** stored or logged.

### Fail-Closed Resilience & Error Contract
- If Upstash Redis times out (`reason === "timeout"`) or experiences network failure, the limiter strictly **fails closed**, returning `503 RATE_LIMIT_UNAVAILABLE`.
- Request paths exceeding limits return `429 RATE_LIMITED`:
  - `Retry-After`: Integer delta seconds (minimum 1).
  - `X-RateLimit-Limit`: Maximum bucket capacity.
  - `X-RateLimit-Remaining`: Remaining token allowance (`0`).
  - `X-RateLimit-Reset`: Unix epoch reset timestamp in seconds.
  - `X-Request-ID`: Correlation ID.
- Rate-limited attempts create **zero** `usage_events` in PostgreSQL.

---

## 8. Runtime & Infrastructure Requirements

- **Node.js Runtime**: Authentication routes, database connection pool, and image transformation routes explicitly declare `runtime = "nodejs"` to leverage native Node.js buffer, cryptographic primitives, and Sharp native binaries.
- **Database Pooling**: Standard `pg.Pool` connection pooling compatible with standard PostgreSQL instances or pooled cloud proxies.
- **Distributed Cache / Rate Limiter**: `@upstash/redis` REST client compatible with serverless Edge and Node.js environments.

---

## 9. Data Retention & Foreign-Key Delete Semantics

To prevent accidental data loss and maintain an untampered audit history:
- **Better Auth Tables (`session`, `account`)**: `ON DELETE CASCADE` when the parent `user` is deleted.
- **`organization_members`**: `ON DELETE CASCADE` when the parent `organizations` or `user` record is removed.
- **`api_keys`**:
  - `organization_id`: `ON DELETE RESTRICT` (organizations with keys cannot be hard-deleted).
  - `created_by_user_id`: `ON DELETE SET NULL` (nullable column; removing a team member retains existing API keys).
- **`usage_events`**:
  - `organization_id`: `ON DELETE RESTRICT`.
  - `api_key_id`: `ON DELETE RESTRICT`.
  - Usage events represent an immutable financial audit stream and must never be erased.

---

## 10. Release-Safety & Deployment Check

Before any production deployment:
1. Verify the installed Next.js version against the latest security advisories.
2. Run `pnpm audit --prod` to ensure zero unmitigated high/critical production vulnerabilities.
3. Rerun the full test suite (`pnpm test`), live Redis suite (`pnpm test:redis-integration`), typecheck (`pnpm typecheck`), and build (`pnpm build`).

---

## 11. Stripe Metered Billing & Usage Reporting Architecture

### Modern Stripe Billing Meters
- Modern **Stripe Billing Meters** (`stripe.billing.meterEvents.create` and `stripe.billing.meters.listEventSummaries`) replace legacy Usage Records.
- The image transformation endpoint (`POST /v1/images/transform`) never calls or waits for Stripe. `usage_events` remains the immutable local financial source of truth.

### Background Batch Reporting & Worker Leasing
- Background workers (`src/lib/services/billing-worker.ts`) acquire a database-backed distributed lease (`billing_worker_leases`) to prevent concurrent execution.
- Eligible usage events are grouped into closed UTC windows (`billing_usage_batches`) and mapped in `billing_usage_batch_items`. A database unique constraint on `usage_event_id` ensures a single local transformation event cannot belong to multiple Stripe report batches.
- Meter events are submitted with deterministic identifiers (`imgapi_<batchId>`) and timestamps matching the closed usage window.

### Durable Webhook Ingestion
- Webhooks (`POST /api/webhooks/stripe`) verify raw signatures against `STRIPE_WEBHOOK_SECRET` and insert minimal event metadata into `billing_webhook_events`.
- Asynchronous worker processes the durable inbox with strict event ordering guards against out-of-order delivery.
- Sensitive payment details, card data, and unrestricted raw Stripe JSON are never stored.

### Two-Layer Usage Reconciliation
- Local reconciliation verifies eligible `usage_events` against `billing_usage_batch_items` and batch unit sums.
- Provider reconciliation queries Stripe Meter Event Summaries, computing the signed difference between local reported units and provider aggregates while accounting for asynchronous settlement delays.

### Owner-Only Authorization & Customer Portal
- Customer provisioning occurs safely without blocking organization creation.
- Hosted Stripe Checkout (mode: `subscription`) and Customer Portal sessions are restricted to verified organization owners. All pricing and customer identifiers are derived strictly on the server.
