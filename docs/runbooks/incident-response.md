# Incident Response & Operational Runbook

## Core Principles

1. **Security First**: Never paste credentials, API keys, database connection strings, customer email addresses, or raw multipart image bytes into incident tickets, Slack channels, or public postmortems.
2. **Fail-Closed Verification**: The system is designed to fail-closed on rate-limit or authentication ambiguity to protect backend systems from abuse.
3. **No Unscoped Modifications**: Never run `TRUNCATE`, `DROP TABLE`, or unscoped `DELETE` queries during an incident.

---

## 1. Readiness Failure (P1)

### Signal
`GET /api/health/ready` returns HTTP 503 with `"checks": { "database": "unhealthy" }` or `"redis": "unhealthy"`.

### Triage Steps
1. Execute CLI readiness check:
   ```bash
   pnpm health:check -- https://api.imageapi.dev
   ```
2. Check PostgreSQL connectivity & SSL verification:
   ```bash
   pnpm db:smoke
   ```
3. Check Redis connectivity:
   ```bash
   pnpm test:redis-integration
   ```

### Remediation
- **If Database Unhealthy**:
  - Verify Neon compute endpoint status in Neon console.
  - Check Neon connection limit and pool exhaustion.
  - Verify TLS parameter: `sslmode=verify-full&channel_binding=require`.
- **If Redis Unhealthy**:
  - Verify Upstash Redis cluster status in Upstash dashboard.
  - Confirm `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are valid.
  - Rate limiter fails closed (503) by design until Redis connectivity is restored.

---

## 2. Elevated 5xx Rate (P1)

### Signal
`POST /v1/images/transform` returning HTTP 500 `INTERNAL_ERROR`.

### Triage Steps
1. Filter structured logs for `transform.failed` events with `statusCode: 500`.
2. Check `errorCode` and `requestId` in log entry.
3. Inspect whether errors correlate with specific image input formats or memory limits.

### Remediation
- If Sharp OOM (Out of Memory) occurs on large payloads, verify 10MB payload size limits (`MAX_IMAGE_FILE_SIZE_BYTES`).
- Verify database transaction limits on `usage_events` writes.
- Restart application workers or roll back deployment if regression is isolated to new code commit.

---

## 3. Rate Limiter Outage (P1)

### Signal
Requests receive 503 `RATE_LIMIT_UNAVAILABLE` with error `Upstash Redis connection timeout`.

### Triage Steps
1. Verify Upstash Redis REST endpoint response time:
   ```bash
   curl -s -o /dev/null -w "%{time_total}\n" https://<upstash-endpoint>/ping -H "Authorization: Bearer <token>"
   ```
2. Confirm Upstash daily quota limit has not been exceeded.

### Remediation
- Upgrade Upstash Redis capacity if quota is exhausted.
- If region latency is elevated, configure Redis read replicas or failover endpoint.

---

## 4. High Transformation Latency (P2)

### Signal
P95 transformation duration exceeds 250ms.

### Triage Steps
1. Inspect `transform.completed` structured log entries for `durationMs`.
2. Check `details.format`, `details.width`, `details.height`, and `details.sizeBytes`.

### Remediation
- Check if clients are sending oversized 4096x4096 images with high CPU compression settings (e.g. `quality: 100` with complex AVIF encoding).
- Scale Vercel serverless function memory allocation (e.g. 1024MB or 1792MB for Sharp SIMD processing).

---

## 5. Webhook Inbox Backlog (P2)

### Signal
`billing_webhook_events` table contains > 100 pending/processing rows older than 10 minutes.

### Triage Steps
1. Query database for pending webhook count:
   ```sql
   SELECT status, count(*), min(created_at)
   FROM billing_webhook_events
   GROUP BY status;
   ```
2. Check if billing worker lease is stuck:
   ```sql
   SELECT * FROM billing_worker_leases;
   ```

### Remediation
- Manually trigger billing worker CLI:
  ```bash
  pnpm billing:worker
  ```
- If lease is stuck due to hard crash, leases automatically expire after 60 seconds (`expires_at < now()`).

---

## 6. Meter Event Reporting Failure (P2)

### Signal
`billing_usage_batches` table contains rows in `failed` or `manual_review` status.

### Triage Steps
1. Query failed usage batches:
   ```sql
   SELECT id, organization_id, units, status, error_code, attempt_count, window_start, window_end
   FROM billing_usage_batches
   WHERE status IN ('failed', 'manual_review');
   ```
2. Verify Stripe configuration:
   ```bash
   pnpm stripe:verify-config
   ```

### Remediation
- **If `manual_review` due to `timestamp_out_of_bounds`**:
  - Events older than 35 days cannot be reported to Stripe Meter Events automatically.
  - Review tenant history and adjust manually via Stripe Customer balance adjustments.
- **If `failed` due to temporary Stripe outage**:
  - Reset attempt count to 0 and status to `pending` to trigger worker retry.

---

## 7. Reconciliation Mismatch (P3)

### Signal
`billing_reconciliation_runs` has `status = 'mismatch'`.

### Triage Steps
1. Run reconciliation CLI for affected tenant:
   ```bash
   pnpm billing:reconcile
   ```
2. Note that Stripe Meter Event Summaries take **~45–60 seconds** to aggregate in Stripe's engine; recent usage within 15 minutes is normally marked `pending_provider`.
3. If difference persists after 1 hour:
   - Check if usage batch was reported successfully in `billing_usage_batches`.
   - Verify Stripe Meter identifier format: `imgapi_<batch_id>`.

---

## What NEVER to Include in Incident Artifacts
- **NEVER** include `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `CRON_SECRET`.
- **NEVER** include full `DATABASE_URL` with password or `UPSTASH_REDIS_REST_TOKEN`.
- **NEVER** include user plaintext API keys (`img_live_...`) or user email addresses.
- **NEVER** include raw multipart image buffers or customer uploaded files.
