// ツールの台帳と、作成・停止・復元・削除・戻す。実際の反映はリリースをキューに入れてワーカーが行う。
import path from "node:path";
import { isTextPath, toTablePrefix, validateToolName, type UploadFile } from "@okiba/shared";
import { and, desc, eq, ne } from "drizzle-orm";
import { getAdapters } from "../adapters";
import { readDirAsFiles } from "../adapters/files";
import { config } from "../config";
import { platformDb } from "../db/platform";
import { releases, toolEditors, tools, uploadTokens, type ReleaseRow, type ToolRow } from "../db/schema";
import { ApiError } from "../lib/errors";
import { dropTables, dumpTables, listToolTables } from "./dump";
import { otherPrefixes } from "./prefixes";
import { enqueueRelease, latestReleaseByTool, parsePayload, succeededReplaceReleases } from "./releases";
import { deleteAllSecrets } from "./secrets";

export interface ToolListItem extends ToolRow {
  lastRelease?: ReleaseRow;
  url: string;
}

export function toolUrl(name: string): string {
  return `${config.OKIBA_TOOLS_URL.replace(/\/$/, "")}/tools/${name}`;
}

export async function listTools(): Promise<ToolListItem[]> {
  const rows = await platformDb().select().from(tools).where(ne(tools.status, "deleted")).orderBy(tools.name);
  const latest = await latestReleaseByTool();
  return rows.map((t) => ({ ...t, lastRelease: latest.get(t.id), url: toolUrl(t.name) }));
}

export async function getTool(name: string): Promise<ToolRow | undefined> {
  const [row] = await platformDb().select().from(tools).where(eq(tools.name, name)).limit(1);
  return row;
}

/** 削除済みでないツール。無ければ 404 */
export async function requireTool(name: string): Promise<ToolRow> {
  const tool = await getTool(name);
  if (!tool || tool.status === "deleted") throw new ApiError(404, "ツールが見つかりません");
  return tool;
}

export async function getEditors(toolId: number): Promise<string[]> {
  const rows = await platformDb().select({ email: toolEditors.email }).from(toolEditors).where(eq(toolEditors.toolId, toolId));
  return rows.map((r) => r.email).sort();
}

/** ひな形を読み、__TOOL_NAME__ と __PREFIX__ を置き換える */
export async function loadTemplateFiles(name: string): Promise<UploadFile[]> {
  const dir = path.join(config.templatesDir, "tool");
  const files = await readDirAsFiles(dir);
  if (files.length === 0) throw new Error(`ひな形が見つかりません: ${dir}`);
  const prefix = toTablePrefix(name);
  return files.map((file) => {
    if (!isTextPath(file.path)) return file;
    const text = Buffer.from(file.content, "base64").toString("utf8");
    const replaced = text.replace(/__TOOL_NAME__/g, name).replace(/__PREFIX__/g, prefix);
    return { path: file.path, content: replaced, encoding: "utf8" as const };
  });
}

export interface CreateToolInput {
  name: string;
  description: string;
  owner: string;
}

export async function createTool(input: CreateToolInput): Promise<ToolRow> {
  const name = input.name.trim();
  const nameError = validateToolName(name);
  if (nameError) throw new ApiError(400, nameError);
  const description = input.description.trim();
  if (!description) throw new ApiError(400, "説明を入力してください");

  const db = platformDb();
  const existing = await getTool(name);
  if (existing) {
    throw new ApiError(409, "その名前はすでに使われています(削除済みの名前も再利用できません)");
  }
  const mine = await db
    .select({ id: tools.id })
    .from(tools)
    .where(and(eq(tools.owner, input.owner), ne(tools.status, "deleted")));
  if (mine.length >= config.OKIBA_MAX_TOOLS_PER_USER) {
    throw new ApiError(400, `1 人あたりのツール数の上限(${config.OKIBA_MAX_TOOLS_PER_USER})に達しています`);
  }

  const files = await loadTemplateFiles(name);
  const [result] = await db.insert(tools).values({ name, description, owner: input.owner, status: "live" });
  const tool = (await getTool(name))!;
  await enqueueRelease({ toolId: result.insertId, op: "replace", reason: "create", createdBy: input.owner, payload: files });
  return tool;
}

export async function stopTool(name: string, by: string): Promise<void> {
  const tool = await requireTool(name);
  if (tool.status !== "live") throw new ApiError(400, "停止できるのは公開中のツールだけです");
  const snapshot = await getAdapters().source.readTool(name);
  const deleteAt = new Date(Date.now() + config.OKIBA_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  await enqueueRelease({ toolId: tool.id, op: "remove", reason: "stop", createdBy: by, payload: snapshot.files, baseSha: snapshot.baseSha });
  await platformDb().update(tools).set({ status: "stopped", deleteScheduledAt: deleteAt }).where(eq(tools.id, tool.id));
}

export async function restoreTool(name: string, by: string): Promise<void> {
  const tool = await requireTool(name);
  if (tool.status !== "stopped") throw new ApiError(400, "復元できるのは停止中のツールだけです");
  const [latestStop] = await platformDb()
    .select()
    .from(releases)
    .where(and(eq(releases.toolId, tool.id), eq(releases.reason, "stop")))
    .orderBy(desc(releases.id))
    .limit(1);
  const files = latestStop ? parsePayload(latestStop) : undefined;
  if (!files) throw new ApiError(400, "停止時の内容が見つからないため復元できません");
  await enqueueRelease({ toolId: tool.id, op: "replace", reason: "restore", createdBy: by, payload: files });
  await platformDb().update(tools).set({ status: "live", deleteScheduledAt: null }).where(eq(tools.id, tool.id));
}

/** 削除 = 停止して猶予期間後に完全削除。すでに停止中なら予定を保つ */
export async function scheduleDelete(name: string, by: string): Promise<void> {
  const tool = await requireTool(name);
  if (tool.status === "live") await stopTool(name, by);
}

/** テーブル、認証情報、トークンを消す。ワーカーの予定削除と、管理者の即時削除から呼ぶ */
export async function hardDeleteTool(name: string): Promise<void> {
  const tool = await requireTool(name);
  if (tool.status !== "stopped") throw new ApiError(400, "完全削除は停止中のツールにだけ行えます");
  const prefix = toTablePrefix(name);
  const others = await otherPrefixes(name);
  const tables = await listToolTables(prefix, others);
  if (tables.length > 0) {
    const sql = await dumpTables(prefix, others);
    await getAdapters().dumps.putDump(name, "delete", sql);
    await dropTables(tables);
  }
  await deleteAllSecrets(tool);
  await platformDb()
    .update(uploadTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(uploadTokens.toolId, tool.id)));
  await platformDb().update(tools).set({ status: "deleted", deletedAt: new Date(), deleteScheduledAt: null }).where(eq(tools.id, tool.id));
}

export async function rollbackTool(name: string, by: string): Promise<void> {
  if (config.OKIBA_MODE === "local") throw new ApiError(400, "ローカルモードでは戻せません");
  const tool = await requireTool(name);
  if (tool.status !== "live") throw new ApiError(400, "戻せるのは公開中のツールだけです");
  const [, previous] = await succeededReplaceReleases(tool.id, 2);
  if (!previous?.commitSha) throw new ApiError(400, "戻せるリリースがありません");
  const files = await getAdapters().source.readToolAt(name, previous.commitSha);
  await enqueueRelease({ toolId: tool.id, op: "replace", reason: "rollback", createdBy: by, payload: files, baseSha: previous.commitSha });
}

export async function addEditor(name: string, email: string): Promise<void> {
  const tool = await requireTool(name);
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new ApiError(400, "メールアドレスの形式が正しくありません");
  await platformDb().insert(toolEditors).values({ toolId: tool.id, email: e }).onDuplicateKeyUpdate({ set: { email: e } });
}

export async function removeEditor(name: string, email: string): Promise<void> {
  const tool = await requireTool(name);
  await platformDb()
    .delete(toolEditors)
    .where(and(eq(toolEditors.toolId, tool.id), eq(toolEditors.email, email.trim().toLowerCase())));
}

export async function changeOwner(name: string, newOwner: string): Promise<void> {
  const tool = await requireTool(name);
  const e = newOwner.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new ApiError(400, "メールアドレスの形式が正しくありません");
  await platformDb().update(tools).set({ owner: e }).where(eq(tools.id, tool.id));
}
