// ツールの migrations/*.sql を tools database に適用する。適用済みは platform.migrations に記録する。
import { splitSqlStatements, toTablePrefix, type UploadFile } from "@okiba/shared";
import { eq } from "drizzle-orm";
import { getAdapters } from "../adapters";
import { platformDb } from "../db/platform";
import { migrations, type ToolRow } from "../db/schema";
import { toolsDb } from "../db/tools-db";
import { dumpTables } from "./dump";
import { otherPrefixes } from "./prefixes";

export function migrationFilename(path: string): string {
  return path.slice("migrations/".length);
}

/** まだ適用していないマイグレーションをファイル名順に返す(純粋関数) */
export function pendingMigrationFiles(files: UploadFile[], applied: string[]): UploadFile[] {
  const done = new Set(applied);
  return files
    .filter((f) => /^migrations\/[^/]+\.sql$/.test(f.path))
    .filter((f) => !done.has(migrationFilename(f.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function appliedMigrations(toolId: number): Promise<string[]> {
  const rows = await platformDb().select({ filename: migrations.filename }).from(migrations).where(eq(migrations.toolId, toolId));
  return rows.map((r) => r.filename);
}

export interface ApplyResult {
  applied: string[];
  dumpUrl?: string;
}

export async function applyToolMigrations(tool: ToolRow, files: UploadFile[], releaseId: number): Promise<ApplyResult> {
  const pending = pendingMigrationFiles(files, await appliedMigrations(tool.id));
  if (pending.length === 0) return { applied: [] };

  const prefix = toTablePrefix(tool.name);
  const others = await otherPrefixes(tool.name);
  const { dumps } = getAdapters();
  const { url: dumpUrl } = await dumps.putDump(tool.name, releaseId, await dumpTables(prefix, others));

  const db = toolsDb();
  const applied: string[] = [];
  for (const file of pending) {
    const sql = file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
    const statements = splitSqlStatements(sql);
    for (let i = 0; i < statements.length; i++) {
      try {
        await db.query(statements[i]);
      } catch (err) {
        throw new Error(`${file.path} の ${i + 1} 文目でエラー: ${(err as Error).message}`);
      }
    }
    await platformDb().insert(migrations).values({ toolId: tool.id, filename: migrationFilename(file.path) });
    applied.push(migrationFilename(file.path));
  }
  return { applied, dumpUrl };
}
