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

*Milestone 3 (Developer Dashboard for Keys and Usage) is scheduled next.*

---

## Prerequisites

- **Node.js**: `>=20.9.0` (compatible with Node 20.x, 22.x, 24.x)
- **Package Manager**: `pnpm` (`>=9.0.0`)
- **Database**: PostgreSQL (`v15+`, developed against Neon Serverless PostgreSQL)

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
| `DATABASE_URL` | PostgreSQL pooled connection string (runtime) | `postgres://user:pass@ep-xyz-pooler.region.neon.tech/neondb?sslmode=require` |
| `DIRECT_DATABASE_URL` | PostgreSQL direct unpooled connection (migrations) | `postgres://user:pass@ep-xyz.region.neon.tech/neondb?sslmode=require` |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth (min 32 chars) | `generate-using-crypto-random-32-bytes` |
| `BETTER_AUTH_URL` | Canonical Better Auth base URL | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Application public URL | `http://localhost:3000` |
| `DATABASE_ENV` | Environment marker (`development` \| `production`) | `development` |
| `DEVELOPMENT_DATABASE_ENDPOINT_ID` | Pinned Neon endpoint identifier for fail-closed dev safety | `ep-example-development` |
| `RUN_DB_INTEGRATION_TESTS` | Safety opt-in for live DB integration tests | `true` |

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
- `pnpm test`: Runs Vitest in-memory unit test suite (129 tests).
- `pnpm test:integration`: Runs live PostgreSQL integration suite with safety guards (21 tests).
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

---

## What Is Intentionally Deferred (Out of Scope for M2)

The following features are intentionally not implemented yet and are scheduled for subsequent milestones:

- Real-time usage event stream visualization on dashboard (Milestone 3).
- Rate limiting and Redis/Upstash integrations (Milestone 4).
- Stripe customer synchronization and metered billing reporting (Milestone 5).
- Background worker queues and async job dispatch.
- Multi-user invitations and team management.
- Email delivery provider integration for verification links.
- Social OAuth providers.
