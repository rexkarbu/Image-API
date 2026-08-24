# Internal Operational API & CLI Reference

This document details internal, operational, and non-public endpoints and tools that are excluded from the public OpenAPI 3.1.1 specification.

---

## 1. Stripe Webhook Ingestion (`POST /api/webhooks/stripe`)

### Purpose
Receives asynchronous event notifications from Stripe (e.g. `checkout.session.completed`, `customer.subscription.created`, `invoice.paid`).

### Security Contract
- **Signature Verification**: Verifies `Stripe-Signature` header using raw unmodified body buffer and `STRIPE_WEBHOOK_SECRET`.
- **Test Mode Gating**: Asserts `livemode === false`.
- **Payload Limit**: Strictly enforces `MAX_WEBHOOK_PAYLOAD_BYTES` (1 MiB).
- **Durable Inbox Pattern**: Immediately records event into PostgreSQL table `billing_webhook_events` with `status: 'pending'` and returns HTTP `200` to Stripe in < 50ms.
- **Privacy Guarantee**: Does not store raw request payloads, signatures, or card details.

### Status Codes
- `200 OK`: Event verified and recorded into inbox idempotently.
- `400 Bad Request`: Missing/invalid signature or corrupt payload.
- `413 Payload Too Large`: Payload exceeds 1 MiB.

---

## 2. Protected Billing Cron Worker (`GET /api/cron/billing`)

### Purpose
Trigger endpoint for the background billing worker (run by external scheduler or Vercel Cron in M6.1).

### Security Contract
- **Bearer Authentication**: Requires `Authorization: Bearer <CRON_SECRET>`.
- **Constant-Time Verification**: Uses `crypto.timingSafeEqual()` to prevent timing attacks.
- **Worker Leasing**: Acquires transactional row lease in `billing_worker_leases` for 60 seconds.

### Response Body Example
```json
{
  "success": true,
  "processedWebhooks": 2,
  "provisionedCustomers": 0,
  "createdBatches": 1,
  "reportedBatches": 1,
  "errorsCount": 0
}
```

---

## 3. Operational CLI Utilities

| Command | Purpose | Target Environment |
| :--- | :--- | :--- |
| `pnpm billing:worker` | Manually runs the background billing worker cycle | Local / Staging / Prod |
| `pnpm billing:reconcile` | Runs usage reconciliation for all active subscriptions | Local / Staging / Prod |
| `pnpm stripe:verify-config` | Verifies test mode, meter ID, and price ID with Stripe API | Preflight / CI |
| `pnpm db:smoke` | Validates PostgreSQL connectivity across all 18 tables | Preflight / CI |
| `pnpm db:verify` | Asserts fail-closed foreign keys, unique indexes, and checks | Preflight / CI |
| `pnpm health:check -- <url>`| Executes liveness and readiness probes against target URL | Deployment Verification |
