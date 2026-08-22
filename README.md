# Image API (Temporary Working Title)

Usage-based developer platform for image resizing, format conversion, and optimization.

## Current Milestone Status

**Milestone 0 — Project Foundation, Auth, Database, and Multi-Tenancy** (Completed)

This milestone establishes the multi-tenant architecture, authentication with Better Auth, PostgreSQL database schema with Drizzle ORM, onboarding flow, and developer dashboard shell.

---

## Prerequisites

- **Node.js**: `>=20.9.0` (compatible with Node 20.x, 22.x, 24.x)
- **Package Manager**: `pnpm` (`>=9.0.0`)
- **Database**: PostgreSQL (`v15+`)

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
| `DATABASE_URL` | PostgreSQL pooled connection string | `postgres://postgres:postgres@localhost:5432/image_api_db` |
| `BETTER_AUTH_SECRET` | Secret key for Better Auth (min 32 chars) | `generate-using-openssl-rand-base64-32` |
| `BETTER_AUTH_URL` | Canonical Better Auth base URL | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Application public URL | `http://localhost:3000` |

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

3. **Apply Database Migrations** (requires reachable PostgreSQL instance):
   ```bash
   pnpm db:migrate
   ```

4. **Start Development Server**:
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
- `pnpm test`: Runs Vitest test suite.
- `pnpm db:generate`: Generates SQL migration files from Drizzle schema.
- `pnpm db:migrate`: Executes pending SQL migrations against target database.
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
