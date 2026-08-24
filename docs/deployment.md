# Deployment Guide & Environment Variable Matrix

## Deployment Policy & Principles

1. **Explicit Migrations**: Database migrations (`pnpm db:migrate`) are **never executed during `next build`**. Migrations must be run as an independent, protected pre-deployment step.
2. **Safe Preflight**: Every deployment must pass `pnpm deploy:preflight` before promotion.
3. **Fail-Closed Security**: Missing Redis tokens or invalid PostgreSQL TLS settings immediately halt execution.
4. **Stripe Test Mode Restriction**: Stripe remains in test/sandbox mode (`STRIPE_ENV="test"`) across all initial deployment milestones.

---

## 1. Environment Variable Matrix

| Variable Name | Local Development | Preview Environment | Production Environment | Secret / Sensitive |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | `development` | `production` | `production` | No |
| `VERCEL_ENV` | *(unset)* | `preview` | `production` | No |
| `BETTER_AUTH_URL` | `http://localhost:3000` | `https://preview-<hash>.vercel.app` | `https://api.imageapi.dev` | No |
| `BETTER_AUTH_SECRET` | `<32-byte-hex>` | `<32-byte-hex>` | `<32-byte-hex>` | **YES** |
| `DATABASE_URL` | `postgresql://...?sslmode=verify-full` | `postgresql://...?sslmode=verify-full` | `postgresql://...?sslmode=verify-full` | **YES** |
| `DIRECT_DATABASE_URL` | `postgresql://...?sslmode=verify-full` | `postgresql://...?sslmode=verify-full` | `postgresql://...?sslmode=verify-full` | **YES** |
| `UPSTASH_REDIS_REST_URL` | `https://<id>.upstash.io` | `https://<id>.upstash.io` | `https://<id>.upstash.io` | **YES** |
| `UPSTASH_REDIS_REST_TOKEN`| `<upstash-token>` | `<upstash-token>` | `<upstash-token>` | **YES** |
| `STRIPE_ENV` | `test` | `test` | `test` | No |
| `STRIPE_SECRET_KEY` | `sk_test_...` | `sk_test_...` | `sk_test_...` | **YES** |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | `whsec_...` | `whsec_...` | **YES** |
| `STRIPE_METER_ID` | `mtr_test_...` | `mtr_test_...` | `mtr_test_...` | No |
| `STRIPE_METERED_PRICE_ID` | `price_...` | `price_...` | `price_...` | No |
| `STRIPE_METER_EVENT_NAME` | `image_transform` | `image_transform` | `image_transform` | No |
| `CRON_SECRET` | `<32-byte-hex>` | `<32-byte-hex>` | `<32-byte-hex>` | **YES** |

---

## 2. Deployment Preflight & Verification Tooling

### Preflight Command (`pnpm deploy:preflight`)
Validates environment configuration, database TLS compliance, test-mode rules, and build assets without executing network deployment:
```bash
pnpm deploy:preflight
```

### Post-Deployment Verification (`pnpm deploy:verify -- <url>`)
Validates a target deployment URL (must be HTTPS for remote domains; allows loopback HTTP for local):
```bash
# Verify Preview / Staging
pnpm deploy:verify -- https://preview-deployment.vercel.app

# Verify Production
pnpm deploy:verify -- https://api.imageapi.dev
```

Checks executed by `deploy:verify`:
- `GET /api/health/live` -> 200 OK
- `GET /api/health/ready` -> 200 OK
- `GET /openapi.json` -> 200 OK (valid OpenAPI 3.1.1)
- `GET /docs` -> 200 OK

---

## 3. Database Migration Workflow

When schema changes occur:
1. Generate migration:
   ```bash
   pnpm db:generate
   ```
2. Verify migration metadata consistency:
   ```bash
   pnpm db:check
   ```
3. Apply migration to database:
   ```bash
   pnpm db:migrate
   ```
4. Verify database assertions:
   ```bash
   pnpm db:verify
   ```

---

## 4. Rollback & Secret Rotation Procedures

### Deployment Rollback
If a defect is detected post-deployment:
1. Instantly roll back the Vercel deployment alias to the previous known-good deployment SHA in the Vercel Dashboard.
2. Since schema migrations are backward-compatible (expand/contract pattern), the previous deployment code remains fully compatible with the PostgreSQL database.

### Secret Rotation
- **API Keys / Session Secrets**: Update `BETTER_AUTH_SECRET` in Vercel Environment Variables and redeploy. Existing sessions will prompt re-login.
- **Stripe Webhook Secret**: Add new webhook endpoint in Stripe Dashboard -> copy new `whsec_...` -> update `STRIPE_WEBHOOK_SECRET` in Vercel -> redeploy -> delete old webhook endpoint.
- **Upstash Redis Token**: Create new REST token in Upstash console -> update `UPSTASH_REDIS_REST_TOKEN` in Vercel -> redeploy -> delete old token.
