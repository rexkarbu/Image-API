import { describe, it, expect } from "vitest";
import {
  normalizeCheckClause,
  assertCheckConstraints,
  REQUIRED_CHECK_CONSTRAINTS,
} from "@/db/verify-metadata";

describe("PostgreSQL Metadata Verifier & Check Constraint Pure Unit Tests", () => {
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
  ];

  it("normalizes PostgreSQL check clause formatting and whitespace", () => {
    const raw = "(((status = 'active'::text) AND (revoked_at IS NULL)))";
    const normalized = normalizeCheckClause(raw);
    expect(normalized).toBe("status = 'active' AND revoked_at IS NULL");
  });

  it("passes when all exact check constraints with valid expressions are provided", () => {
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, validCheckRows)).not.toThrow();
  });

  it("fails when api_keys_expires_at_check contains ONLY expires_at IS NULL", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, check_clause: "(expires_at IS NULL)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_expires_at_check' failed semantic validation/
    );
  });

  it("fails when api_keys_expires_at_check contains ONLY expires_at > created_at", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, check_clause: "(expires_at > created_at)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_keys_expires_at_check' failed semantic validation/
    );
  });

  it("fails when a constraint has correct clause but wrong constraint name", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_keys_expires_at_check"
        ? { ...r, constraint_name: "wrong_constraint_name" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Missing exact check constraint 'api_keys_expires_at_check'/
    );
  });

  it("fails when an enum check constraint is missing a required member", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "api_key_audit_events_type_check"
        ? { ...r, check_clause: "(event_type = ANY (ARRAY['created'::text, 'revoked'::text]))" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'api_key_audit_events_type_check' failed semantic validation/
    );
  });

  it("fails when usage_events_status_code_2xx is missing upper or lower bound", () => {
    const badRows = validCheckRows.map((r) =>
      r.constraint_name === "usage_events_status_code_2xx"
        ? { ...r, check_clause: "(status_code >= 200)" }
        : r
    );
    expect(() => assertCheckConstraints(REQUIRED_CHECK_CONSTRAINTS, badRows)).toThrow(
      /Check constraint 'usage_events_status_code_2xx' failed semantic validation/
    );
  });
});
