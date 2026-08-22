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
        | [Cookie Session: Better Auth]                             | [Bearer Key: SHA-256]
        v                                                           v
+-------------------------------+                           +-----------------------+
|     Next.js App Server        |                           |  Node.js Processing   |
|   (Server Components/Auth)    |                           |  (Sharp / Transform)  |
+-------------------------------+                           +-----------------------+
        |                                                           |
        | Tenant-Scoped DB Query                                    | Record Usage Event
        v                                                           v
+-----------------------------------------------------------------------------------+
|                        PostgreSQL Database (Drizzle ORM)                          |
|  - user / session / account                                                       |
|  - organizations / organization_members                                           |
|  - api_keys (hashed SHA-256)                                                      |
|  - usage_events (append-only immutable stream)                                    |
+-----------------------------------------------------------------------------------+
```

---

## 2. Authentication Models

### Dashboard Authentication (Interactive Session)
- Built using **Better Auth** with the official **Drizzle Adapter** on PostgreSQL.
- Authenticates users via email and password for MVP.
- Issues secure HTTP-only cookies with server-side session lookup.
- Protects administrative routes and onboarding logic on the server prior to data access.

### API Consumer Authentication (Machine-to-Machine)
- Inbound API requests will present Bearer tokens (`img_live_...`).
- Tokens are hashed using SHA-256 and matched against `api_keys.key_hash`.
- Plaintext keys are never stored in the database or logs.

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

## 4. Usage Events & Billing Architecture

### Immutable Audit Log (`usage_events`)
- The `usage_events` table serves as the primary system of record for all metered activity.
- Every successful transformation creates an immutable event record containing:
  - `request_id` (Unique idempotency key)
  - `organization_id`
  - `api_key_id`
  - `endpoint`
  - `units` (strictly > 0)
  - `status_code`
  - `created_at` (Timestamp with timezone)

### Decoupled Metering & Async Billing
- **Request Path**: Synchronously records the event in PostgreSQL or fast buffer.
- **Billing Path**: Asynchronous batch aggregation for Stripe metered billing reconciliation in future milestones.
- Failed processing or validation errors do not generate billable usage units.

---

## 5. Runtime & Infrastructure Requirements

- **Node.js Runtime**: Authentication routes, database connection pool, and upcoming image transformation routes explicitly declare `runtime = "nodejs"` to leverage native Node.js buffer and cryptographic primitives.
- **Database Pooling**: Standard `pg.Pool` connection pooling compatible with any standard PostgreSQL instance or pooled cloud proxy.

---

## 6. Data Retention & Foreign-Key Delete Semantics

To prevent accidental data loss and maintain an untampered audit history:
- **Better Auth Tables (`session`, `account`)**: `ON DELETE CASCADE` when the parent `user` is deleted.
- **`organization_members`**: `ON DELETE CASCADE` when the parent `organizations` or `user` record is removed.
- **`api_keys`**:
  - `organization_id`: `ON DELETE RESTRICT` (organizations with keys cannot be hard-deleted).
  - `created_by_user_id`: `ON DELETE SET NULL` (nullable column; removing a team member retains existing API keys).
- **`usage_events`**:
  - `organization_id`: `ON DELETE RESTRICT`.
  - `api_key_id`: `ON DELETE RESTRICT`.
  - Usage events represent an immutable audit stream and must never be deleted.

---

## 7. Release-Safety & Deployment Check

Before any production deployment:
1. Verify the installed Next.js version against the latest security advisories.
2. Run `pnpm audit --prod` to ensure zero unmitigated high/critical production vulnerabilities.
3. Rerun the full test suite (`pnpm test`), typecheck (`pnpm typecheck`), and build (`pnpm build`).

