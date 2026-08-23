import { describe, it, expect } from "vitest";
import {
  normalizeCheckClause,
  assertCheckConstraints,
  REQUIRED_CHECK_CONSTRAINTS,
} from "@/db/verify-metadata";

describe("PostgreSQL Metadata Verifier & Complete Fail-Closed Check Constraint Unit Tests", () => {
  // Positive fixtures derived from actual PostgreSQL catalog output
  const validCheckRows = [
    {
      table_name: "usage_events",
      constraint_name: "usage_events_units_equals_one",
      check_clause: "(units = 1)",
    },
    {
      table_name: "usage_events",
      constraint_name: "usage_events_request_id_format",
      check_clause: "(request_id ~ '^[0-9a-f]{64}$'::text)",
    },
    {
      table_name: "usage_events",
      constraint_name: "usage_events_status_code_2xx",
      check_clause: "((status_code >= 200) AND (status_code <= 299))",
    },
    {
      table_name: "api_key_audit_events",
      constraint_name: "api_key_audit_events_type_check",
      check_clause:
        "(event_type = ANY (ARRAY['created'::text, 'revoked'::text, 'rotation_created'::text, 'expiration_scheduled'::text]))",
    },
    {
      table_name: "api_keys",
      constraint_name: "api_keys_status_check",
      check_clause: "(status = ANY (ARRAY['active'::text, 'revoked'::text]))",
    },
    {
      table_name: "api_keys",
      constraint_name: "api_keys_key_hash_format",
      check_clause: "(key_hash ~ '^[0-9a-f]{64}$'::text)",
    },
    {
      table_name: "api_keys",
      constraint_name: "api_keys_key_prefix_format",
      check_clause: "(key_prefix ~ '^img_live_[A-Za-z0-9_-]{8}$'::text)",
    },
    {
      table_name: "api_keys",
      constraint_name: "api_keys_status_revoked_consistency",
      check_clause:
        "(((status = 'active'::text) AND (revoked_at IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL)))",
    },
    {
      table_name: "api_keys",
      constraint_name: "api_keys_scopes_check",
      check_clause: "(scopes = 'image:transform'::text)",
    },
    {
      table_name: "api_keys",
      constraint_name: "api_keys_expires_at_check",
      check_clause: "((expires_at IS NULL) OR (expires_at > created_at))",
    },
    {
      table_name: "billing_checkout_sessions",
      constraint_name: "billing_checkout_sessions_status_check",
      check_clause:
        "(status = ANY (ARRAY['creating'::text, 'open'::text, 'completed'::text, 'expired'::text, 'failed'::text]))",
    },
    {
      table_name: "billing_customers",
      constraint_name: "billing_customers_status_check",
      check_clause:
        "(provisioning_status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text]))",
    },
    {
      table_name: "billing_customers",
      constraint_name: "billing_customers_attempt_count_check",
      check_clause: "(attempt_count >= 0)",
    },
    {
      table_name: "billing_invoices",
      constraint_name: "billing_invoices_status_check",
      check_clause:
        "(status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'uncollectible'::text, 'void'::text]))",
    },
    {
      table_name: "billing_invoices",
      constraint_name: "billing_invoices_amount_due_check",
      check_clause: "(amount_due >= 0)",
    },
    {
      table_name: "billing_invoices",
      constraint_name: "billing_invoices_amount_paid_check",
      check_clause: "(amount_paid >= 0)",
    },
    {
      table_name: "billing_invoices",
      constraint_name: "billing_invoices_period_check",
      check_clause: "(period_end >= period_start)",
    },
    {
      table_name: "billing_reconciliation_runs",
      constraint_name: "billing_reconciliation_runs_status_check",
      check_clause:
        "(status = ANY (ARRAY['pending_provider'::text, 'matched'::text, 'mismatch'::text, 'failed'::text]))",
    },
    {
      table_name: "billing_reconciliation_runs",
      constraint_name: "billing_reconciliation_runs_period_check",
      check_clause: "(period_end > period_start)",
    },
    {
      table_name: "billing_reconciliation_runs",
      constraint_name: "billing_reconciliation_runs_counts_check",
      check_clause:
        "((local_eligible_units >= 0) AND (batched_units >= 0) AND (reported_units >= 0) AND (stripe_aggregated_units >= 0))",
    },
    {
      table_name: "billing_subscriptions",
      constraint_name: "billing_subscriptions_status_check",
      check_clause:
        "(status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'paused'::text, 'unpaid'::text, 'canceled'::text, 'incomplete'::text, 'incomplete_expired'::text]))",
    },
    {
      table_name: "billing_subscriptions",
      constraint_name: "billing_subscriptions_period_check",
      check_clause: "(current_period_end > current_period_start)",
    },
    {
      table_name: "billing_usage_batches",
      constraint_name: "billing_usage_batches_status_check",
      check_clause:
        "(status = ANY (ARRAY['pending'::text, 'processing'::text, 'reported'::text, 'failed'::text, 'manual_review'::text]))",
    },
    {
      table_name: "billing_usage_batches",
      constraint_name: "billing_usage_batches_units_check",
      check_clause: "(units > 0)",
    },
    {
      table_name: "billing_usage_batches",
      constraint_name: "billing_usage_batches_window_check",
      check_clause: "(window_end > window_start)",
    },
    {
      table_name: "billing_usage_batches",
      constraint_name: "billing_usage_batches_attempt_count_check",
      check_clause: "(attempt_count >= 0)",
    },
    {
      table_name: "billing_webhook_events",
      constraint_name: "billing_webhook_events_status_check",
      check_clause:
        "(status = ANY (ARRAY['pending'::text, 'processing'::text, 'processed'::text, 'failed'::text]))",
    },
    {
      table_name: "billing_webhook_events",
      constraint_name: "billing_webhook_events_attempt_count_check",
      check_clause: "(attempt_count >= 0)",
    },
  ];

  it("normalizes PostgreSQL check clause formatting, casts, and whitespace", () => {
    const raw = "(((status = 'active'::text) AND (revoked_at IS NULL)))";
    const normalized = normalizeCheckClause(raw);
    expect(normalized).toBe("status = 'active' AND revoked_at IS NULL");
  });

  it("passes when all exact check constraints with valid expressions are provided", () => {
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, validCheckRows)).not.toThrow();
  });

  // 1. Appended Tautology & Invariant Weakening Tests
  it("fails closed when api_keys_expires_at_check is followed by OR TRUE", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, check_clause: "((expires_at IS NULL) OR (expires_at > created_at)) OR TRUE" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_expires_at_check' failed semantic validation/
    );
  });

  it("fails closed when api_keys_status_revoked_consistency is followed by OR TRUE", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_status_revoked_consistency"
        ? {
            ...r,
            check_clause:
              "(((status = 'active'::text) AND (revoked_at IS NULL)) OR ((status = 'revoked'::text) AND (revoked_at IS NOT NULL))) OR TRUE",
          }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_status_revoked_consistency' failed semantic validation/
    );
  });

  it("fails closed when api_keys_status_check is followed by OR TRUE", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_status_check"
        ? { ...r, check_clause: "(status = ANY (ARRAY['active'::text, 'revoked'::text])) OR TRUE" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_status_check' failed semantic validation/
    );
  });

  it("fails closed when api_key_audit_events_type_check is followed by OR TRUE", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_key_audit_events_type_check"
        ? {
            ...r,
            check_clause:
              "(event_type = ANY (ARRAY['created'::text, 'revoked'::text, 'rotation_created'::text, 'expiration_scheduled'::text])) OR TRUE",
          }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_key_audit_events_type_check' failed semantic validation/
    );
  });

  it("fails closed when usage_events_status_code_2xx is followed by AND TRUE", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "usage_events_status_code_2xx"
        ? { ...r, check_clause: "((status_code >= 200) AND (status_code <= 299)) AND TRUE" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'usage_events_status_code_2xx' failed semantic validation/
    );
  });

  // 2. Operator & Connector Inversion Tests
  it("fails closed when api_keys_expires_at_check connects branches with AND instead of OR", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, check_clause: "((expires_at IS NULL) AND (expires_at > created_at))" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_expires_at_check' failed semantic validation/
    );
  });

  it("fails closed when api_keys_expires_at_check contains ONLY expires_at IS NULL", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, check_clause: "(expires_at IS NULL)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_expires_at_check' failed semantic validation/
    );
  });

  it("fails closed when api_keys_expires_at_check contains ONLY expires_at > created_at", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, check_clause: "(expires_at > created_at)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_expires_at_check' failed semantic validation/
    );
  });

  it("fails closed when usage_events_status_code_2xx connects bounds with OR instead of AND", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "usage_events_status_code_2xx"
        ? { ...r, check_clause: "((status_code >= 200) OR (status_code <= 299))" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'usage_events_status_code_2xx' failed semantic validation/
    );
  });

  // 3. Enum Set Bounds & Extra Values Tests
  it("fails closed when api_keys_status_check contains an extra unexpected enum value ('suspended')", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_status_check"
        ? { ...r, check_clause: "(status = ANY (ARRAY['active'::text, 'revoked'::text, 'suspended'::text]))" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_status_check' failed semantic validation/
    );
  });

  it("fails closed when api_key_audit_events_type_check contains an extra unexpected enum value ('deleted')", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_key_audit_events_type_check"
        ? {
            ...r,
            check_clause:
              "(event_type = ANY (ARRAY['created'::text, 'revoked'::text, 'rotation_created'::text, 'expiration_scheduled'::text, 'deleted'::text]))",
          }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_key_audit_events_type_check' failed semantic validation/
    );
  });

  it("fails closed when api_keys_scopes_check uses <> instead of =", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_scopes_check"
        ? { ...r, check_clause: "(scopes <> 'image:transform'::text)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_scopes_check' failed semantic validation/
    );
  });

  // 4. Column Swapping & Negation Tests
  it("fails closed when a correct regex is applied to the wrong column", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "usage_events_request_id_format"
        ? { ...r, check_clause: "(key_hash ~ '^[0-9a-f]{64}$'::text)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'usage_events_request_id_format' failed semantic validation/
    );
  });

  it("fails closed when units constraint is negated or wrong value", () => {
    const negatedRows = validCheckRows.map((r) =>
      r.constraint_name === "usage_events_units_equals_one"
        ? { ...r, check_clause: "NOT (units = 1)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, negatedRows)).toThrow(
      /Check constraint 'usage_events_units_equals_one' failed semantic validation/
    );

    const wrongValRows = validCheckRows.map((r) =>
      r.constraint_name === "usage_events_units_equals_one"
        ? { ...r, check_clause: "(units = 2)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, wrongValRows)).toThrow(
      /Check constraint 'usage_events_units_equals_one' failed semantic validation/
    );
  });

  it("fails closed when a constraint has correct clause but wrong constraint name", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, constraint_name: "wrong_constraint_name" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Missing exact check constraint 'api_keys_expires_at_check'/
    );
  });
});
