import { describe, expect, it } from "vitest";
import { pendingMigrationFiles } from "../src/services/migrations";
import { validateToolUpload } from "../src/services/uploads";

const page = { path: "page.tsx", content: "export default function Page(){return null}" };

describe("validateToolUpload", () => {
  it("accepts migrations that only touch own prefix", () => {
    const errors = validateToolUpload(
      [page, { path: "migrations/0001_init.sql", content: "CREATE TABLE visit_memo_notes (id INT PRIMARY KEY);" }],
      "visit-memo",
      ["other_"],
    );
    expect(errors).toEqual([]);
  });
  it("rejects migrations touching other tools' tables", () => {
    const errors = validateToolUpload(
      [page, { path: "migrations/0001_init.sql", content: "DROP TABLE other_items;" }],
      "visit-memo",
      ["other_"],
    );
    expect(errors.some((e) => e.includes("visit_memo_"))).toBe(true);
  });
  it("rejects clashes with a longer prefix of another tool", () => {
    const errors = validateToolUpload(
      [page, { path: "migrations/0001_init.sql", content: "CREATE TABLE a_b_items (id INT);" }],
      "a",
      ["a_b_"],
    );
    expect(errors.some((e) => e.includes("a_b_"))).toBe(true);
  });
  it("rejects bad migration file names", () => {
    const errors = validateToolUpload([page, { path: "migrations/init.sql", content: "CREATE TABLE a_x (id INT);" }], "a", []);
    expect(errors.some((e) => e.includes("0001_"))).toBe(true);
  });
  it("rejects platform files and secrets", () => {
    const errors = validateToolUpload([page, { path: "package.json", content: "{}" }], "a", []);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("pendingMigrationFiles", () => {
  it("returns unapplied sql files in order", () => {
    const files = [
      { path: "migrations/0002_add.sql", content: "" },
      { path: "page.tsx", content: "" },
      { path: "migrations/0001_init.sql", content: "" },
      { path: "migrations/notes.txt", content: "" },
    ];
    expect(pendingMigrationFiles(files, ["0001_init.sql"]).map((f) => f.path)).toEqual(["migrations/0002_add.sql"]);
    expect(pendingMigrationFiles(files, []).map((f) => f.path)).toEqual(["migrations/0001_init.sql", "migrations/0002_add.sql"]);
  });
});
