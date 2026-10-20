// リリースの台帳。ツールのコードの正本は releases.payload と tools.current_release_id。
import type { UploadFile } from "@okiba/shared";
import { and, asc, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { platformDb } from "../db/platform";
import { releases, tools, type ReleaseOp, type ReleaseReason, type ReleaseRow, type ToolRow } from "../db/schema";
import { ApiError } from "../lib/errors";

export interface EnqueueInput {
  toolId: number | null;
  op: ReleaseOp;
  reason: ReleaseReason;
  createdBy: string;
  payload?: UploadFile[];
  baseVersion?: string;
}

export async function enqueueRelease(input: EnqueueInput): Promise<number> {
  const [result] = await platformDb()
    .insert(releases)
    .values({
      toolId: input.toolId,
      op: input.op,
      reason: input.reason,
      createdBy: input.createdBy,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      baseVersion: input.baseVersion ?? null,
    });
  return result.insertId;
}

export function parsePayload(release: Pick<ReleaseRow, "payload">): UploadFile[] | undefined {
  if (!release.payload) return undefined;
  return JSON.parse(release.payload) as UploadFile[];
}

export async function getReleaseRow(id: number): Promise<ReleaseRow | undefined> {
  const [row] = await platformDb().select().from(releases).where(eq(releases.id, id)).limit(1);
  return row;
}

/** ツールのバージョン = 反映中のリリース ID。まだ無ければ "0" */
export function versionOf(tool: Pick<ToolRow, "currentReleaseId">): string {
  return String(tool.currentReleaseId ?? 0);
}

export interface ToolSnapshot {
  files: UploadFile[];
  baseVersion: string;
}

/** いま反映されているコード。files API と停止時のスナップショットに使う */
export async function currentToolFiles(tool: Pick<ToolRow, "currentReleaseId">): Promise<ToolSnapshot> {
  if (tool.currentReleaseId === null) return { files: [], baseVersion: "0" };
  const row = await getReleaseRow(tool.currentReleaseId);
  return { files: (row && parsePayload(row)) ?? [], baseVersion: versionOf(tool) };
}

/** 公開中で反映済みのツール全部のコード。ビルド用の zip に使う */
export async function liveToolFiles(): Promise<Array<{ name: string; files: UploadFile[] }>> {
  const rows = await platformDb()
    .select()
    .from(tools)
    .where(and(eq(tools.status, "live"), isNotNull(tools.currentReleaseId)));
  const out: Array<{ name: string; files: UploadFile[] }> = [];
  for (const tool of rows) {
    out.push({ name: tool.name, files: (await currentToolFiles(tool)).files });
  }
  return out;
}

export async function queuePosition(releaseId: number): Promise<number> {
  const rows = await platformDb()
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.status, "queued"), lt(releases.id, releaseId)));
  return rows.length + 1;
}

export interface ReleaseView {
  id: number;
  reason: string;
  status: string;
  queuePosition?: number;
  baseVersion: string | null;
  appRef: string | null;
  log: string | null;
  logUrl: string | null;
  dumpUrl: string | null;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export function toReleaseView(row: ReleaseRow, position?: number): ReleaseView {
  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    queuePosition: position,
    baseVersion: row.baseVersion,
    appRef: row.appRef,
    log: row.log,
    logUrl: row.logUrl,
    dumpUrl: row.dumpUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export async function getRelease(tool: ToolRow, releaseId: number): Promise<ReleaseView> {
  const [row] = await platformDb()
    .select()
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.toolId, tool.id)))
    .limit(1);
  if (!row) throw new ApiError(404, "リリースが見つかりません");
  const position = row.status === "queued" ? await queuePosition(row.id) : undefined;
  return toReleaseView(row, position);
}

export async function listReleases(toolId: number, limit = 20): Promise<ReleaseRow[]> {
  return platformDb().select().from(releases).where(eq(releases.toolId, toolId)).orderBy(desc(releases.id)).limit(limit);
}

export async function latestReleaseByTool(): Promise<Map<number, ReleaseRow>> {
  const rows = await platformDb().select().from(releases).orderBy(desc(releases.id)).limit(500);
  const map = new Map<number, ReleaseRow>();
  for (const row of rows) {
    if (row.toolId !== null && !map.has(row.toolId)) map.set(row.toolId, row);
  }
  return map;
}

/** 反映中のリリースより前の、成功した replace リリース(戻す先) */
export async function previousSucceededReplace(tool: Pick<ToolRow, "id" | "currentReleaseId">): Promise<ReleaseRow | undefined> {
  if (tool.currentReleaseId === null) return undefined;
  const [row] = await platformDb()
    .select()
    .from(releases)
    .where(
      and(
        eq(releases.toolId, tool.id),
        eq(releases.op, "replace"),
        eq(releases.status, "succeeded"),
        lt(releases.id, tool.currentReleaseId),
      ),
    )
    .orderBy(desc(releases.id))
    .limit(1);
  return row;
}

export async function latestSucceededRelease(): Promise<ReleaseRow | undefined> {
  const [row] = await platformDb().select().from(releases).where(eq(releases.status, "succeeded")).orderBy(desc(releases.id)).limit(1);
  return row;
}

export async function hasPendingRelease(toolId?: number): Promise<boolean> {
  const conditions = [inArray(releases.status, ["queued", "building", "migrating", "deploying"])];
  if (toolId !== undefined) conditions.push(eq(releases.toolId, toolId));
  const rows = await platformDb()
    .select({ id: releases.id })
    .from(releases)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

export async function hasQueuedReconcile(): Promise<boolean> {
  const rows = await platformDb()
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.op, "reconcile"), inArray(releases.status, ["queued", "building", "migrating", "deploying"])))
    .limit(1);
  return rows.length > 0;
}

/** 全ツールを今の基盤で作り直す(管理者の「再ビルド」と調整ループ) */
export async function enqueueRebuild(by: string): Promise<number> {
  if (await hasQueuedReconcile()) throw new ApiError(409, "再ビルドはすでにキューにあります");
  return enqueueRelease({ toolId: null, op: "reconcile", reason: "reconcile", createdBy: by });
}

export async function oldestQueued(): Promise<ReleaseRow | undefined> {
  const [row] = await platformDb().select().from(releases).where(eq(releases.status, "queued")).orderBy(asc(releases.id)).limit(1);
  return row;
}

export async function activeRelease(): Promise<ReleaseRow | undefined> {
  const [row] = await platformDb()
    .select()
    .from(releases)
    .where(inArray(releases.status, ["building", "migrating", "deploying"]))
    .orderBy(asc(releases.id))
    .limit(1);
  return row;
}
