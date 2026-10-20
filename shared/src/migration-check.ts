// migrations/*.sql の検証。
// 対象のテーブルが自分の接頭語で始まり、他のツールの接頭語にかかっていないことを機械的に確かめる。

export interface MigrationCheckOptions {
  /** 自分の接頭語(例: visit_memo_) */
  prefix: string;
  /** 他のツールの接頭語。自分より長く、自分の接頭語で始まるものがあると衝突しうる */
  otherPrefixes?: string[];
}

/** コメントを除き、クォートの外の ; で文を分ける */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (quote) {
      current += ch;
      if (ch === "\\" && quote !== "`") {
        current += next ?? "";
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      current += "\n";
      continue;
    }
    if (ch === "#") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      current += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const IDENT = "(?:`[^`]+`|[A-Za-z0-9_$.]+)";

function stripQuotes(ident: string): string {
  return ident.replace(/^`|`$/g, "");
}

export interface StatementTargets {
  kind: string;
  tables: string[];
}

/** 文の種類と対象テーブルを取り出す。対応していない文は null */
export function extractStatementTargets(statement: string): StatementTargets | null {
  const s = statement.replace(/\s+/g, " ").trim();
  const patterns: Array<{ kind: string; re: RegExp; multi?: boolean }> = [
    { kind: "create table", re: new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?(${IDENT})`, "i") },
    { kind: "alter table", re: new RegExp(`^ALTER TABLE (${IDENT})`, "i") },
    { kind: "drop table", re: new RegExp(`^DROP TABLE (?:IF EXISTS )?(${IDENT}(?: ?, ?${IDENT})*)`, "i"), multi: true },
    { kind: "truncate", re: new RegExp(`^TRUNCATE (?:TABLE )?(${IDENT})`, "i") },
    { kind: "create index", re: new RegExp(`^CREATE (?:UNIQUE |FULLTEXT |SPATIAL )?INDEX ${IDENT} ON (${IDENT})`, "i") },
    { kind: "drop index", re: new RegExp(`^DROP INDEX ${IDENT} ON (${IDENT})`, "i") },
    { kind: "insert", re: new RegExp(`^INSERT (?:IGNORE )?(?:INTO )?(${IDENT})`, "i") },
    { kind: "update", re: new RegExp(`^UPDATE (${IDENT}) SET`, "i") },
    { kind: "delete", re: new RegExp(`^DELETE FROM (${IDENT})`, "i") },
  ];
  for (const p of patterns) {
    const m = s.match(p.re);
    if (m) {
      const raw = m[1];
      const tables = p.multi ? raw.split(",").map((t) => stripQuotes(t.trim())) : [stripQuotes(raw)];
      return { kind: p.kind, tables };
    }
  }
  const rename = s.match(/^RENAME TABLE (.+)$/i);
  if (rename) {
    const tables: string[] = [];
    for (const pair of rename[1].split(",")) {
      const m = pair.trim().match(new RegExp(`^(${IDENT}) TO (${IDENT})$`, "i"));
      if (!m) return null;
      tables.push(stripQuotes(m[1]), stripQuotes(m[2]));
    }
    return { kind: "rename table", tables };
  }
  return null;
}

export function checkMigrationSql(sql: string, options: MigrationCheckOptions): string[] {
  const errors: string[] = [];
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) {
    errors.push("SQL 文がありません");
    return errors;
  }
  const longerPrefixes = (options.otherPrefixes ?? []).filter(
    (p) => p !== options.prefix && p.startsWith(options.prefix),
  );
  statements.forEach((statement, index) => {
    const targets = extractStatementTargets(statement);
    const label = `${index + 1} 文目`;
    if (!targets) {
      errors.push(`${label}: この種類の SQL はマイグレーションでは使えません: ${statement.slice(0, 60)}`);
      return;
    }
    for (const table of targets.tables) {
      if (table.includes(".")) {
        errors.push(`${label}: データベース名付きのテーブル指定は使えません: ${table}`);
        continue;
      }
      if (!table.startsWith(options.prefix)) {
        errors.push(`${label}: テーブル名は ${options.prefix} で始めてください: ${table}`);
        continue;
      }
      const clash = longerPrefixes.find((p) => table.startsWith(p));
      if (clash) {
        errors.push(`${label}: ${table} は他のツールの接頭語 ${clash} と重なります`);
      }
    }
  });
  return errors;
}
