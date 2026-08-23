# Image API (Temporary Working Title)

Usage-based developer platform for image resizing, format conversion, and optimization.

## Current Milestone Status

**Milestone 0 — Project Foundation, Auth, Database, and Multi-Tenancy** (Completed)
- **M0.1**: Upgraded to Next.js 16.3.2, ESLint Flat Config, patched Drizzle ORM security release, and enforced secure foreign-key delete actions (`CASCADE` / `RESTRICT` / `SET NULL`).
- **M0.2**: Live PostgreSQL integration with Neon (pooled runtime + direct migration connections), Better Auth session/auth lifecycle verified E2E, and guarded live integration test suite.

*Milestone 1 (API-Key Lifecycle) has not been started.*

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

6. **Start Development Server**:
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
- `pnpm test`: Runs Vitest in-memory unit test suite (56 tests).
- `pnpm test:integration`: Runs live PostgreSQL integration suite with safety guards (5 tests).
- `pnpm db:generate`: Generates SQL migration files from Drizzle schema.
- `pnpm db:check`: Checks Drizzle schema snapshot consistency.
- `pnpm db:migrate`: Executes pending SQL migrations over direct connection.
- `pnpm db:smoke`: Validates live PostgreSQL connection and verifies all 8 tables.
- `pnpm db:verify`: Executes assertion-based metadata verification against live schema.
- `pnpm db:studio`: Opens Drizzle Studio for visual database inspection.

---

## What Is Intentionally Deferred (Out of Scope for M0)

The following features are intentionally not implemented yet and are scheduled for subsequent milestones:

- Image processing endpoint (`POST /v1/images/transform`) and `sharp`.
- Plaintext API key creation and secret revelation UI.
- Rate limiting and Redis/Upstash integrations.
- Stripe customer synchronization and metered billing reporting.
- Background worker queues and async job dispatch.
- Multi-user invitations and team management.
- Email delivery provider integration for verification links.
- Social OAuth providers.
