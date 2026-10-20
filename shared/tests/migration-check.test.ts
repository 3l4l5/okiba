import { describe, expect, it } from "vitest";
import { checkMigrationSql, extractStatementTargets, splitSqlStatements } from "../src/migration-check";

describe("splitSqlStatements", () => {
  it("splits on semicolons and trims", () => {
    expect(splitSqlStatements("CREATE TABLE a (id int);\nCREATE TABLE b (id int);")).toEqual([
      "CREATE TABLE a (id int)",
      "CREATE TABLE b (id int)",
    ]);
  });
  it("ignores line and block comments", () => {
    const sql = `-- first; comment
CREATE TABLE a (id int); # trailing; comment
/* block; comment */ CREATE TABLE b (id int);`;
    expect(splitSqlStatements(sql)).toEqual(["CREATE TABLE a (id int)", "CREATE TABLE b (id int)"]);
  });
  it("keeps semicolons inside quotes", () => {
    const sql = `INSERT INTO a (v) VALUES ('x;y', "p;q", 'it\\'s;');`;
    expect(splitSqlStatements(sql)).toEqual([`INSERT INTO a (v) VALUES ('x;y', "p;q", 'it\\'s;')`]);
  });
  it("keeps semicolons inside backticks", () => {
    const sql = "CREATE TABLE `we;ird` (id int); CREATE TABLE b (id int);";
    expect(splitSqlStatements(sql)).toEqual(["CREATE TABLE `we;ird` (id int)", "CREATE TABLE b (id int)"]);
  });
  it("handles a trailing statement without semicolon", () => {
    expect(splitSqlStatements("CREATE TABLE a (id int)")).toEqual(["CREATE TABLE a (id int)"]);
  });
});

describe("extractStatementTargets", () => {
  it("create table", () => {
    expect(extractStatementTargets("CREATE TABLE IF NOT EXISTS `a_x` (id int)")).toEqual({
      kind: "create table",
      tables: ["a_x"],
    });
    expect(extractStatementTargets("create table a_x (id int)")).toEqual({ kind: "create table", tables: ["a_x"] });
  });
  it("alter table", () => {
    expect(extractStatementTargets("ALTER TABLE a_x ADD COLUMN v int")).toEqual({ kind: "alter table", tables: ["a_x"] });
  });
  it("drop table with multiple tables", () => {
    expect(extractStatementTargets("DROP TABLE IF EXISTS a_x, `a_y`")).toEqual({
      kind: "drop table",
      tables: ["a_x", "a_y"],
    });
  });
  it("truncate", () => {
    expect(extractStatementTargets("TRUNCATE TABLE a_x")).toEqual({ kind: "truncate", tables: ["a_x"] });
    expect(extractStatementTargets("TRUNCATE a_x")).toEqual({ kind: "truncate", tables: ["a_x"] });
  });
  it("create index", () => {
    expect(extractStatementTargets("CREATE UNIQUE INDEX idx ON a_x (v)")).toEqual({
      kind: "create index",
      tables: ["a_x"],
    });
    expect(extractStatementTargets("CREATE INDEX idx ON `a_x` (v)")).toEqual({ kind: "create index", tables: ["a_x"] });
  });
  it("drop index", () => {
    expect(extractStatementTargets("DROP INDEX idx ON a_x")).toEqual({ kind: "drop index", tables: ["a_x"] });
  });
  it("insert", () => {
    expect(extractStatementTargets("INSERT INTO a_x (v) VALUES (1)")).toEqual({ kind: "insert", tables: ["a_x"] });
    expect(extractStatementTargets("INSERT IGNORE INTO a_x (v) VALUES (1)")).toEqual({ kind: "insert", tables: ["a_x"] });
  });
  it("update", () => {
    expect(extractStatementTargets("UPDATE a_x SET v = 1")).toEqual({ kind: "update", tables: ["a_x"] });
  });
  it("delete", () => {
    expect(extractStatementTargets("DELETE FROM a_x WHERE id = 1")).toEqual({ kind: "delete", tables: ["a_x"] });
  });
  it("rename table", () => {
    expect(extractStatementTargets("RENAME TABLE a_x TO a_y, `a_p` TO `a_q`")).toEqual({
      kind: "rename table",
      tables: ["a_x", "a_y", "a_p", "a_q"],
    });
  });
  it("returns null for unsupported statements", () => {
    expect(extractStatementTargets("GRANT ALL ON a_x TO 'u'@'%'")).toBeNull();
    expect(extractStatementTargets("USE okiba_tools")).toBeNull();
    expect(extractStatementTargets("CREATE DATABASE evil")).toBeNull();
    expect(extractStatementTargets("SELECT * FROM a_x")).toBeNull();
    expect(extractStatementTargets("RENAME TABLE a_x")).toBeNull();
  });
});

describe("checkMigrationSql", () => {
  const prefix = "visit_memo_";

  it("accepts statements that only touch prefixed tables", () => {
    const sql = `
      CREATE TABLE visit_memo_notes (id int primary key, body text);
      CREATE INDEX idx_body ON visit_memo_notes (id);
      ALTER TABLE \`visit_memo_notes\` ADD COLUMN created_at datetime;
      INSERT INTO visit_memo_notes (id, body) VALUES (1, 'a;b');
      RENAME TABLE visit_memo_notes TO visit_memo_memos;
      DROP TABLE IF EXISTS visit_memo_tmp, visit_memo_old;
    `;
    expect(checkMigrationSql(sql, { prefix })).toEqual([]);
  });

  it("rejects unprefixed tables", () => {
    const errors = checkMigrationSql("CREATE TABLE notes (id int)", { prefix });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("visit_memo_ で始めてください");
  });

  it("rejects db-qualified table names", () => {
    const errors = checkMigrationSql("CREATE TABLE okiba_platform.visit_memo_x (id int)", { prefix });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("データベース名付き");
  });

  it("rejects unsupported statements", () => {
    for (const sql of [
      "GRANT ALL ON visit_memo_x TO 'u'@'%'",
      "USE okiba_tools",
      "CREATE DATABASE visit_memo_db",
      "SELECT * FROM visit_memo_x",
    ]) {
      const errors = checkMigrationSql(sql, { prefix });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("この種類の SQL はマイグレーションでは使えません");
    }
  });

  it("rejects empty input", () => {
    expect(checkMigrationSql("-- nothing here", { prefix })).toEqual(["SQL 文がありません"]);
  });

  it("rejects a clash with a longer other prefix", () => {
    const errors = checkMigrationSql("CREATE TABLE a_b_x (id int)", { prefix: "a_", otherPrefixes: ["a_b_"] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("他のツールの接頭語 a_b_");
    // own tables that do not overlap are fine
    expect(checkMigrationSql("CREATE TABLE a_c_x (id int)", { prefix: "a_", otherPrefixes: ["a_b_"] })).toEqual([]);
    // unrelated other prefixes are ignored
    expect(checkMigrationSql("CREATE TABLE a_b_x (id int)", { prefix: "a_", otherPrefixes: ["z_"] })).toEqual([]);
  });

  it("reports the statement number", () => {
    const errors = checkMigrationSql("CREATE TABLE visit_memo_a (id int); CREATE TABLE other (id int);", { prefix });
    expect(errors).toEqual([expect.stringContaining("2 文目")]);
  });
});
