import { describe, it, expect } from "vitest";

describe("Fail-Closed Metadata Verifier Assertion Logic (Pure Unit Tests)", () => {
  const EXPECTED_TABLES = [
    "account",
    "api_keys",
    "organization_members",
    "organizations",
    "session",
    "usage_events",
    "user",
    "verification",
  ];

  function assertTables(existingTables: string[]) {
    const missingTables = EXPECTED_TABLES.filter((t) => !existingTables.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Metadata Assertion Failed: Missing required tables: [${missingTables.join(", ")}]`);
    }
  }

  function assertPlaintextColumns(columns: { column_name: string }[]) {
    const suspicious = columns.find((c) =>
      ["key", "api_key", "secret", "token", "plaintext"].includes(c.column_name.toLowerCase())
    );
    if (suspicious) {
      throw new Error(`Metadata Assertion Failed: Plaintext key column '${suspicious.column_name}' detected!`);
    }
  }

  function assertForeignKeyDeleteRules(
    fks: { table_name: string; column_name: string; foreign_table_name: string; foreign_column_name: string; delete_rule: string }[]
  ) {
    const requiredFk = {
      table: "organization_members",
      column: "organization_id",
      foreignTable: "organizations",
      foreignColumn: "id",
      deleteRule: "CASCADE",
    };
    const match = fks.find(
      (r) =>
        r.table_name === requiredFk.table &&
        r.column_name === requiredFk.column &&
        r.foreign_table_name === requiredFk.foreignTable &&
        r.foreign_column_name === requiredFk.foreignColumn
    );
    if (!match) {
      throw new Error("Metadata Assertion Failed: Missing required FK");
    }
    if (match.delete_rule !== requiredFk.deleteRule) {
      throw new Error(`Metadata Assertion Failed: FK has delete rule '${match.delete_rule}', expected '${requiredFk.deleteRule}'`);
    }
  }

  it("passes when all expected tables exist", () => {
    expect(() => assertTables([...EXPECTED_TABLES, "extra_future_table"])).not.toThrow();
  });

  it("fails closed when an expected table is missing", () => {
    const incompleteTables = EXPECTED_TABLES.filter((t) => t !== "usage_events");
    expect(() => assertTables(incompleteTables)).toThrow(
      "Metadata Assertion Failed: Missing required tables: [usage_events]"
    );
  });

  it("fails closed when a suspicious plaintext column is present in api_keys", () => {
    const cols = [
      { column_name: "id" },
      { column_name: "key_hash" },
      { column_name: "api_key" }, // suspicious
    ];
    expect(() => assertPlaintextColumns(cols)).toThrow(
      "Metadata Assertion Failed: Plaintext key column 'api_key' detected!"
    );
  });

  it("fails closed when foreign key delete rule is wrong (e.g. SET NULL instead of CASCADE)", () => {
    const fks = [
      {
        table_name: "organization_members",
        column_name: "organization_id",
        foreign_table_name: "organizations",
        foreign_column_name: "id",
        delete_rule: "SET NULL", // invalid
      },
    ];
    expect(() => assertForeignKeyDeleteRules(fks)).toThrow(/expected 'CASCADE'/);
  });
});
