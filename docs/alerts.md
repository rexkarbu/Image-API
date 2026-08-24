# Production Alert Policies & Detection Signals

> [!NOTE]
> **Provisional Thresholds**: The numeric thresholds and percentile targets documented below represent initial baseline estimates. They must be calibrated against measured production traffic in Milestone 6.1. Percentage and latency alert rules require a minimum evaluation sample of at least 50 requests within the rolling window to prevent false positives during low-traffic periods.
>
> **Operational Status**: This document specifies formal detection rules, event names, and severity classifications. In Milestone 6.0, events are emitted via structured logs (`logger.warn` / `logger.error`) and OpenTelemetry spans. Active external paging/dispatch (e.g. PagerDuty / Opsgenie webhook drains) is an infrastructure integration scheduled for Milestone 6.1.

---

## Alert Severity Definitions

| Severity | Definition | Target Triage Window |
| :--- | :--- | :--- |
| **P1 - Critical** | Core request path or database is down. Customer image processing is unavailable. | Immediate (< 15 mins) |
| **P2 - High** | Degraded performance, elevated error rate, or billing reporting backlog. | < 1 hour |
| **P3 - Warning** | Approaching rate capacity, isolated client anomalies, or settling reconciliation delays. | Next business day |

---

## Alert Rules Matrix

### 1. Request Path Readiness Failure (`ALERT_READINESS_FAILED`)
- **Severity**: `P1 - Critical`
- **Signal**: `GET /api/health/ready` returns HTTP `503` continuously for > 2 consecutive probes (60s).
- **Impact**: All image transformation requests are failing closed.
- **Root Causes**: PostgreSQL connection pool exhaustion, Neon connection outage, Upstash Redis network unreachable.
- **Runbook**: [Incident Response Runbook - Section 1](runbooks/incident-response.md#1-readiness-failure-p1)

### 2. High API Error Rate (`ALERT_API_5XX_ELEVATED`)
- **Severity**: `P1 - Critical`
- **Signal**: `POST /v1/images/transform` 5xx responses exceed 1% of total requests over a 5-minute rolling window (minimum sample: 50 requests).
- **Impact**: Customer requests failing unexpectedly.
- **Root Causes**: Uncaught runtime exceptions, Sharp library segfault/OOM, database deadlock.
- **Runbook**: [Incident Response Runbook - Section 2](runbooks/incident-response.md#2-elevated-5xx-rate-p1)

### 3. Distributed Rate Limiter Unavailable (`ALERT_RATELIMIT_UNAVAILABLE`)
- **Severity**: `P1 - Critical`
- **Signal**: `rate_limit_unavailable` events > 5 occurrences in 5 minutes.
- **Impact**: Fail-closed security kicks in; requests return 503 to protect downstream infrastructure.
- **Root Causes**: Upstash Redis REST token expired, rate limit quota reached, DNS resolution failure.
- **Runbook**: [Incident Response Runbook - Section 3](runbooks/incident-response.md#3-rate-limiter-outage-p1)

### 4. High Image Transformation Latency (`ALERT_LATENCY_P95_ELEVATED`)
- **Severity**: `P2 - High`
- **Signal**: `POST /v1/images/transform` P95 latency > 250ms over a 15-minute rolling window (minimum sample: 50 requests).
- **Impact**: Slow API performance for developers.
- **Root Causes**: Oversized source images, CPU contention, database connection latency.
- **Runbook**: [Incident Response Runbook - Section 4](runbooks/incident-response.md#4-high-transformation-latency-p2)

### 5. Stripe Webhook Processing Backlog (`ALERT_WEBHOOK_INBOX_BACKLOG`)
- **Severity**: `P2 - High`
- **Signal**: `billing_webhook_events` table contains > 100 rows in `pending` or `processing` status older than 10 minutes.
- **Impact**: Delayed subscription updates, customer portal desynchronization.
- **Root Causes**: Billing cron worker not running, database worker lease deadlock.
- **Runbook**: [Incident Response Runbook - Section 5](runbooks/incident-response.md#5-webhook-inbox-backlog-p2)

### 6. Meter Event Reporting Failures (`ALERT_METER_REPORTING_FAILED`)
- **Severity**: `P2 - High`
- **Signal**: `billing_usage_batches` status is `failed` or `manual_review` for > 3 batches in 1 hour.
- **Impact**: Metered usage not reported to Stripe, potential revenue loss.
- **Root Causes**: Stripe API outage, invalid Meter configuration, usage timestamp out of bounds (> 35 days old).
- **Runbook**: [Incident Response Runbook - Section 6](runbooks/incident-response.md#6-meter-event-reporting-failure-p2)

### 7. Usage Reconciliation Mismatch (`ALERT_RECONCILIATION_MISMATCH`)
- **Severity**: `P3 - Warning`
- **Signal**: `billing_reconciliation_runs` record has `status = 'mismatch'` (difference > 0 outside the 15-minute settling window).
- **Impact**: Discrepancy between local database usage and Stripe Meter Event Summaries.
- **Root Causes**: Dropped meter events, upstream Stripe aggregation glitch, time-window skew.
- **Runbook**: [Incident Response Runbook - Section 7](runbooks/incident-response.md#7-reconciliation-mismatch-p3)

### 8. Elevated Client 429 Rate Limit Hits (`ALERT_CLIENT_RATE_LIMITED`)
- **Severity**: `P3 - Warning`
- **Signal**: `POST /v1/images/transform` 429 responses exceed 100 req/min for a single tenant.
- **Impact**: Tenant experiencing client-side throttling.
- **Action**: Outreach to tenant for plan upgrade or higher rate limit tier.
