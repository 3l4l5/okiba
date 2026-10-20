// ツールのテーブルを SQL にダンプする。マイグレーション前と完全削除前に使う。
import { escape as mysqlEscape, escapeId } from "mysql2";

type SqlValue = Parameters<typeof mysqlEscape>[0];

function escape(value: unknown): string {
  return mysqlEscape((value ?? null) as SqlValue);
}
import type { RowDataPacket } from "mysql2/promise";
import { toolsDb, toolsDbName } from "../db/tools-db";

const CHUNK = 500;

/** 接頭語で始まり、他のツールのより長い接頭語にかからないテーブルを列挙する */
export function filterToolTables(tableNames: string[], prefix: string, otherLongerPrefixes: string[]): string[] {
  const longer = otherLongerPrefixes.filter((p) => p !== prefix && p.startsWith(prefix));
  return tableNames.filter((t) => t.startsWith(prefix) && !longer.some((p) => t.startsWith(p))).sort();
}

export async function listToolTables(prefix: string, otherLongerPrefixes: string[]): Promise<string[]> {
  const [rows] = await toolsDb().query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE ?",
    [toolsDbName(), `${prefix.replace(/[%_]/g, "\\$&")}%`],
  );
  return filterToolTables(
    rows.map((r) => r.name as string),
    prefix,
    otherLongerPrefixes,
  );
}

/** 行の配列を 1 つの INSERT 文にする(純粋関数) */
export function buildInsertStatement(table: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const values = rows
    .map((row) => `(${columns.map((c) => escape(row[c])).join(", ")})`)
    .join(",\n");
  return `INSERT INTO ${escapeId(table)} (${columns.map((c) => escapeId(c)).join(", ")}) VALUES\n${values};\n`;
}

export async function dumpTables(prefix: string, otherLongerPrefixes: string[]): Promise<string> {
  const db = toolsDb();
  const tables = await listToolTables(prefix, otherLongerPrefixes);
  const parts: string[] = [`-- okiba dump ${new Date().toISOString()} prefix=${prefix}\n`, "SET FOREIGN_KEY_CHECKS=0;\n"];
  for (const table of tables) {
    const [createRows] = await db.query<RowDataPacket[]>(`SHOW CREATE TABLE ${escapeId(table)}`);
    const createSql = createRows[0]?.["Create Table"] as string | undefined;
    parts.push(`\n-- ${table}\nDROP TABLE IF EXISTS ${escapeId(table)};\n${createSql ?? ""};\n`);
    let offset = 0;
    for (;;) {
      const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${escapeId(table)} LIMIT ? OFFSET ?`, [CHUNK, offset]);
      if (rows.length === 0) break;
      parts.push(buildInsertStatement(table, rows as Record<string, unknown>[]));
      if (rows.length < CHUNK) break;
      offset += CHUNK;
    }
  }
  parts.push("SET FOREIGN_KEY_CHECKS=1;\n");
  return parts.join("");
}

export async function dropTables(tables: string[]): Promise<void> {
  const db = toolsDb();
  for (const table of tables) {
    await db.query(`DROP TABLE IF EXISTS ${escapeId(table)}`);
  }
}
