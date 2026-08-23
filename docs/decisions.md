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
    - `api_keys`: `organization_id` uses `ON DELETE RESTRICT` (organizations with active or revoked keys cannot be silently hard-deleted). `created_by_user_id` is nullable with `ON DELETE SET NULL` so removing an individual team member retains the organization's API keys.
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

