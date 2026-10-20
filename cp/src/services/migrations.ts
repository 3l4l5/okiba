// ツールの migrations/*.sql を tools database に適用する。適用済みは platform.migrations に記録する。
//
// 適用済みはファイル名と内容のハッシュで覚える。同じファイル名で内容が変わっていたら、
// 黙ってスキップせずに拒否する(ひな形の 0001 を AI が書き換えてしまう事故を防ぐ)。
import { createHash } from "node:crypto";
import { splitSqlStatements, toTablePrefix, type UploadFile } from "@okiba/shared";
import { eq } from "drizzle-orm";
import { getAdapters } from "../adapters";
import { platformDb } from "../db/platform";
import { migrations, type ToolRow } from "../db/schema";
import { toolsDb } from "../db/tools-db";
import { dumpTables } from "./dump";
import { otherPrefixes } from "./prefixes";

export interface AppliedMigration {
  filename: string;
  /** 内容の sha256。0003 より前に適用した行は null */
  checksum: string | null;
}

export function migrationFilename(path: string): string {
  return path.slice("migrations/".length);
}

export function isMigrationFile(file: UploadFile): boolean {
  return /^migrations\/[^/]+\.sql$/.test(file.path);
}

export function migrationSql(file: UploadFile): string {
  return file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
}

/** 改行コードと末尾の空白の違いは無視したハッシュ */
export function migrationChecksum(file: UploadFile): string {
  const normalized = migrationSql(file).replace(/\r\n/g, "\n").trimEnd();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * 適用済みのファイルと同じ名前で内容が違うものがあればエラーを返す(純粋関数)。
 * アップロード時とリリース時の両方で使う。
 */
export function checkAppliedMigrationsUnchanged(files: UploadFile[], applied: AppliedMigration[]): string[] {
  const errors: string[] = [];
  const byName = new Map(applied.map((m) => [m.filename, m.checksum]));
  for (const file of files) {
    if (!isMigrationFile(file)) continue;
    const name = migrationFilename(file.path);
    if (!byName.has(name)) continue;
    const checksum = byName.get(name);
    if (checksum && checksum !== migrationChecksum(file)) {
      errors.push(
        `${file.path} は適用済みで、内容が変わっています。適用済みのマイグレーションは書き換えず、` +
          `新しい番号のファイル(例: migrations/0002_説明.sql)を足してください`,
      );
    }
  }
  return errors;
}

/** まだ適用していないマイグレーションをファイル名順に返す(純粋関数) */
export function pendingMigrationFiles(files: UploadFile[], applied: AppliedMigration[]): UploadFile[] {
  const done = new Set(applied.map((m) => m.filename));
  return files
    .filter(isMigrationFile)
    .filter((f) => !done.has(migrationFilename(f.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function appliedMigrations(toolId: number): Promise<AppliedMigration[]> {
  return platformDb()
    .select({ filename: migrations.filename, checksum: migrations.checksum })
    .from(migrations)
    .where(eq(migrations.toolId, toolId));
}

export interface ApplyResult {
  applied: string[];
  dumpUrl?: string;
}

export async function applyToolMigrations(tool: ToolRow, files: UploadFile[], releaseId: number): Promise<ApplyResult> {
  const already = await appliedMigrations(tool.id);
  const changed = checkAppliedMigrationsUnchanged(files, already);
  if (changed.length > 0) throw new Error(changed.join("\n"));

  const pending = pendingMigrationFiles(files, already);
  if (pending.length === 0) return { applied: [] };

  const prefix = toTablePrefix(tool.name);
  const others = await otherPrefixes(tool.name);
  const { dumps } = getAdapters();
  const { url: dumpUrl } = await dumps.putDump(tool.name, releaseId, await dumpTables(prefix, others));

  const db = toolsDb();
  const applied: string[] = [];
  for (const file of pending) {
    const statements = splitSqlStatements(migrationSql(file));
    for (let i = 0; i < statements.length; i++) {
      try {
        await db.query(statements[i]);
      } catch (err) {
        throw new Error(`${file.path} の ${i + 1} 文目でエラー: ${(err as Error).message}`);
      }
    }
    await platformDb()
      .insert(migrations)
      .values({ toolId: tool.id, filename: migrationFilename(file.path), checksum: migrationChecksum(file) });
    applied.push(migrationFilename(file.path));
  }
  return { applied, dumpUrl };
}
