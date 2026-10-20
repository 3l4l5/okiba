import { describe, expect, it } from "vitest";
import { buildInsertStatement, filterToolTables } from "../src/services/dump";

describe("buildInsertStatement", () => {
  it("escapes values and identifiers", () => {
    const sql = buildInsertStatement("visit_memo_notes", [
      { id: 1, title: "it's", body: null, created_at: new Date("2026-01-02T03:04:05Z") },
      { id: 2, title: "a\\b", body: Buffer.from("x"), created_at: null },
    ]);
    expect(sql.startsWith("INSERT INTO `visit_memo_notes` (`id`, `title`, `body`, `created_at`) VALUES")).toBe(true);
    expect(sql).toContain("'it\\'s'");
    expect(sql).toContain("NULL");
    expect(sql).toContain("'a\\\\b'");
    expect(sql).toContain("X'78'");
    expect(sql.trimEnd().endsWith(";")).toBe(true);
  });
  it("returns empty for no rows", () => {
    expect(buildInsertStatement("t", [])).toBe("");
  });
});

describe("filterToolTables", () => {
  it("keeps own prefix and excludes longer clashing prefixes", () => {
    const tables = ["a_items", "a_b_items", "a_b_c", "other_x", "ab_items"];
    expect(filterToolTables(tables, "a_", ["a_b_", "other_"])).toEqual(["a_items"]);
    expect(filterToolTables(tables, "a_b_", ["a_"])).toEqual(["a_b_c", "a_b_items"]);
  });
});
