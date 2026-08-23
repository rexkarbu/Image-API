# Architecture Decision Records (ADRs)

## Locked Technical Decisions

1. **Single MVP Domain: Image Processing**
   - The platform focuses exclusively on image manipulation (resize, format conversion, compression).

2. **Usage Unit Definition**
   - One successfully completed image transformation equals exactly 1 billable unit.
   - Validation errors, bad requests, client disconnects, and 5xx pipeline errors are not charged.

3. **Input Transmission Model**
   - Initial MVP will use multipart file uploads (`multipart/form-data`) rather than fetching arbitrary remote URLs to avoid SSRF attack vectors and remote timeout complexities.

4. **Database & ORM**
   - PostgreSQL is selected as the primary relational store.
   - Drizzle ORM is used with `node-postgres` (`pg`) for type-safe query generation and migration management.

5. **Dashboard Authentication**
   - Better Auth with official Drizzle adapter is used for session-based email/password authentication.
   - Session verification occurs strictly server-side before reading tenant resources.

6. **API Key Authentication & Security**
   - API keys are hashed with SHA-256 before storage.
   - Plaintext keys are shown only once upon generation and never stored.
   - Keys include a searchable prefix (e.g. `img_live_...`) and metadata.

7. **Multi-Tenancy Query Isolation**
   - Every tenant-owned database query must include `organization_id` in the filter predicate.
   - Browser-provided organization or user IDs are not trusted for authorization.

8. **Deferred Infrastructure (Post-M0)**
   - Stripe customer synchronization, webhook workers, Redis rate limiters, and async queues are deferred to their designated milestones.
   - Request-path usage recording and Stripe billing synchronization remain decoupled stages.

9. **Temporary Product Label**
   - The product uses the neutral temporary identifier `Image API` centralized in `src/config/site.ts` for clean future rebranding.

10. **Data Retention & Foreign-Key Delete Semantics**
    - `organization_members`: `ON DELETE CASCADE` for parent user or organization removal.
    - `api_keys`: `organization_id` uses `ON DELETE RESTRICT` (organizations with active or revoked keys cannot be hard-deleted). `created_by_user_id` is nullable with `ON DELETE SET NULL` so removing an individual team member retains the organization's API keys.
    - `usage_events`: `organization_id` and `api_key_id` use `ON DELETE RESTRICT`. Usage events represent an immutable financial audit stream and must never be erased.
    - No hard-delete APIs are exposed for organizations, keys, or usage events.

11. **Release-Safety & Audit Policy**
    - Before any production deployment, check the latest stable Next.js security releases, execute `pnpm audit --prod`, and run the complete validation test and build suite.

12. **API Key Lifecycle, One-Time Reveal, and Rotation Policy (Milestone 1)**
    - API keys follow the exact format `img_live_<32-byte-base64url-secret>` (52 characters total length).
    - Keys are stored exclusively as 64-character lowercase SHA-256 hashes (`key_hash`) along with non-sensitive display prefixes (`img_live_ab12cd34`).
    - One-time reveal: The full plaintext key is delivered to the browser exactly once in the successful creation or rotation response and wiped from React state immediately upon dialog dismissal.
    - Rotation: Supports `immediate` (instant revocation of old key) or `grace_24h` (old key remains active for a 24-hour transition window to prevent deployment downtime).
    - Append-only audit: The `api_key_audit_events` table tracks all lifecycle transitions (`created`, `revoked`, `rotation_created`, `expiration_scheduled`) without recording plaintext keys or hashes.
    - Throttled activity timestamps: `last_used_at` updates are throttled to at most once per 5 minutes to prevent write amplification.

13. **Image Transformation Sandboxing, Encoding, and Memory Policy (Milestone 2 & M2.1)**
    - Image decoding is isolated on the Node.js runtime using `sharp` configured with memory, pixel, and channel limits (`failOn: "warning"`, `limitInputPixels: 40_000_000`, `limitInputChannels: 4`, `pages: 1`, `animated: false`, `.timeout({ seconds: 20 })`).
    - Gated input formats: Only `jpeg`, `png`, `webp` are accepted. Multi-page, animated, SVG, AVIF input, and vector documents are rejected to eliminate SSRF and XML entity attack surfaces.
    - Metadata stripping: All EXIF, GPS, XMP, and IPTC metadata are stripped by default on all outputs. Auto-orientation (`.rotate()`) is applied prior to metadata removal.
    - PNG quality handling: PNG uses lossless compression; explicitly supplying a `quality` parameter for PNG output is rejected with `400 INVALID_OPTIONS` rather than pretending lossy compression applies.
    - Fit parameter validation: Supplying `fit` requires both `width` and `height` dimensions to prevent ambiguous resizing behavior.
    - Multipart boundary limits: Accepts up to 7 total parts (1 file + 6 fields) and triggers rejection on the 8th part boundary using `limits.parts: 8`.
    - Transparent JPEG flattening: Converting transparent PNG or WebP images to JPEG automatically flattens alpha channels against solid white.

14. **Idempotent Request-Path Usage Metering & Indistinguishable Authentication (Milestone 2 & M2.1)**
    - Authentication failure indistinguishability: All authentication failures (missing, invalid, revoked, expired, or scope mismatch) return identical HTTP 401 UNAUTHORIZED responses with the fixed generic message `Invalid API credentials.` to prevent credential enumeration.
    - Idempotency keys are mandatory for all transformation requests (16-128 printable ASCII characters).
    - Request IDs in `usage_events` are derived as `SHA-256(organizationId + "\0" + rawIdempotencyKey)`, guaranteeing that raw client idempotency keys are never persisted or exposed in database records or logs.
    - Usage events are inserted atomically with `ON CONFLICT (request_id) DO NOTHING`. Losing duplicate requests immediately receive `409 DUPLICATE_REQUEST` without recording additional units.
    - Usage is recorded only after successful image processing and confirming client connection integrity, ensuring zero billable events on failure paths.

15. **Developer Dashboard Architecture & Zero-Fabrication Usage Analytics (Milestone 3 & M3.1)**
    - Multi-Tenant Analytics Isolation: All analytics and overview metrics are strictly executed via server-only services (`src/lib/services/usage-analytics.ts`) with mandatory `organization_id` predicates resolved from verified session context. All joins to `api_keys` are explicitly scoped by `and(eq(usageEvents.apiKeyId, apiKeys.id), eq(apiKeys.organizationId, organizationId))` to guarantee cross-tenant metadata privacy.
    - Pure DTO Separation: The client layer receives purely serializable DTOs (`src/types/usage.ts`) containing zero Node.js/database dependencies, sanitized of all sensitive credentials and internal key hashes.
    - Deterministic Time-Series Bucketing: Time boundaries are evaluated strictly in UTC. Ranges <= 48 hours use hourly buckets, while ranges > 48 hours use daily buckets (custom range capped at 90 days). Missing time buckets are zero-filled to prevent misleading trend distortions. Custom ranges and bucket generators strictly model half-open intervals `[start, end)` without out-of-range trailing buckets.
    - Stable Cursor Pagination: Event stream pagination orders deterministically by `created_at DESC, id DESC` using opaque Base64URL cursor tokens (`createdAt_id`) to ensure zero duplicated or skipped rows across identical millisecond timestamps. Cursors are strictly validated fail-closed for length, character set, canonical JSON shape, ISO timestamp, and valid ID format.
    - Truthful Quota State & Zero-Percentage Rendering: Quotas are represented as explicitly unconfigured (`configured: false, allowedMonthlyUnits: null`) and rendered as "No quota configured", strictly forbidding synthetic quotas or fabricated progress indicators. When total units are zero, key breakdowns render `—` without progress bars.
    - Tab-Visibility Auto-Refresh: Near-real-time dashboard synchronization polls at ~30s intervals only when `document.visibilityState === "visible"` to prevent idle background resource drain and accumulates zero redundant timers.

16. **Distributed Rate Limiting, Fail-Closed Upstash Redis, and Privacy-Preserving HMAC Identifiers (Milestone 4 & M4.1)**
    - Two-Tier Throttling: Enforces a pre-authentication IP rate limiter (Sliding Window: 120 req / 60s) to protect auth/DB infrastructure and an authenticated API key rate limiter (Token Bucket: 10 tokens / 10s, capacity 20 tokens) to protect compute and memory resources.
    - Privacy-Preserving HMAC Derivation: Stored Redis keys use domain-separated HMAC-SHA-256 (`ip\0` and `key\0`) with a server secret (`RATE_LIMIT_IDENTIFIER_SECRET`). The secret contract strictly requires exactly 64 lowercase hexadecimal characters (32 random bytes) and rejects placeholders, uppercase hex, and non-hex characters.
    - RFC 5952 IPv6 Canonicalization: IPv6 addresses are expanded and canonicalized to standard RFC 5952 lowercase format before hashing so formatting variations map to identical rate-limit buckets.
    - Trusted Client IP & Production Fail-Closed Boundary: In production, trusted IP extraction requires `VERCEL === "1"` and trusts only `x-vercel-forwarded-for`. When running in production outside Vercel, requests fail closed with `503 RATE_LIMIT_UNAVAILABLE` rather than trusting spoofable headers like `x-forwarded-for`.
    - Fail-Closed Upstash Response Validation & Bounded Timeouts: Upstash responses are checked with a pure validator ensuring boolean success, integer positive limit, remaining within `[0, limit]`, and positive reset. Timeouts (`reason === "timeout"`) and unknown reasons fail closed with `503 RATE_LIMIT_UNAVAILABLE`. Timeouts are clamped within `[500, 5000]ms` (default 2500ms in production).
    - Unconditional REST URL Security: `UPSTASH_REDIS_REST_URL` requires `https:` across all environments, validates `.upstash.io` hostnames, and rejects embedded credentials, queries, fragments, and paths.
    - Response Header Allowlist & Security Header Immutability: `createErrorResponse()` restricts rate-limit headers to an explicit allowlist (`Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) matching `/^\d+$/`. Security headers (`Content-Type`, `Cache-Control`, `X-Content-Type-Options`, `X-Request-ID`) can never be overwritten by error payloads.
    - Exact Redis Cleanup: Test cleanup utilizes the official `limiter.resetUsedTokens(identifier)` method without guessing key prefixes, `FLUSHDB`, or `SCAN`, proving full allowance restoration.
    - Zero Usage Metering: Blocked (429) or unavailable (503) requests generate zero PostgreSQL `usage_events` records.
