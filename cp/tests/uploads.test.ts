import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/errors";
import { checkAppliedMigrationsUnchanged, migrationChecksum, pendingMigrationFiles } from "../src/services/migrations";
import { checkBaseVersion, validateToolUpload } from "../src/services/uploads";

describe("checkBaseVersion", () => {
  it("accepts the current version", () => {
    expect(() => checkBaseVersion("12", "12")).not.toThrow();
    expect(() => checkBaseVersion("0", " 0 ")).not.toThrow();
  });
  it("rejects a stale version with 409 and the current one", () => {
    try {
      checkBaseVersion("13", "12");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).details).toEqual({ currentVersion: "13" });
    }
  });
});

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
    const applied = [{ filename: "0001_init.sql", checksum: null }];
    expect(pendingMigrationFiles(files, applied).map((f) => f.path)).toEqual(["migrations/0002_add.sql"]);
    expect(pendingMigrationFiles(files, []).map((f) => f.path)).toEqual(["migrations/0001_init.sql", "migrations/0002_add.sql"]);
  });
});

describe("checkAppliedMigrationsUnchanged", () => {
  const init = { path: "migrations/0001_init.sql", content: "CREATE TABLE a_x (id INT);" };
  it("accepts unchanged and unknown-checksum files", () => {
    const applied = [{ filename: "0001_init.sql", checksum: migrationChecksum(init) }];
    expect(checkAppliedMigrationsUnchanged([init], applied)).toEqual([]);
    expect(checkAppliedMigrationsUnchanged([init], [{ filename: "0001_init.sql", checksum: null }])).toEqual([]);
    expect(checkAppliedMigrationsUnchanged([{ path: "migrations/0002_b.sql", content: "x" }], applied)).toEqual([]);
  });
  it("ignores line endings and trailing whitespace", () => {
    const applied = [{ filename: "0001_init.sql", checksum: migrationChecksum(init) }];
    const crlf = { path: init.path, content: init.content.replace(/\n/g, "\r\n") + "\n\n" };
    expect(checkAppliedMigrationsUnchanged([crlf], applied)).toEqual([]);
  });
  it("rejects a rewritten applied migration", () => {
    const applied = [{ filename: "0001_init.sql", checksum: migrationChecksum(init) }];
    const rewritten = { path: init.path, content: "CREATE TABLE a_visits (id INT);" };
    const errors = checkAppliedMigrationsUnchanged([rewritten], applied);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("0001_init.sql");
    expect(errors[0]).toContain("新しい番号");
  });
});
