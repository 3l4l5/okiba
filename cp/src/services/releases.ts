import type { UploadFile } from "@okiba/shared";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { platformDb } from "../db/platform";
import { releases, type ReleaseOp, type ReleaseReason, type ReleaseRow, type ToolRow } from "../db/schema";
import { ApiError } from "../lib/errors";

export interface EnqueueInput {
  toolId: number | null;
  op: ReleaseOp;
  reason: ReleaseReason;
  createdBy: string;
  payload?: UploadFile[];
  baseSha?: string;
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
      baseSha: input.baseSha ?? null,
    });
  return result.insertId;
}

export function parsePayload(release: Pick<ReleaseRow, "payload">): UploadFile[] | undefined {
  if (!release.payload) return undefined;
  return JSON.parse(release.payload) as UploadFile[];
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
  commitSha: string | null;
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
    commitSha: row.commitSha,
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

/** ツールの、成功した replace リリースを新しい順に返す */
export async function succeededReplaceReleases(toolId: number, limit: number): Promise<ReleaseRow[]> {
  return platformDb()
    .select()
    .from(releases)
    .where(and(eq(releases.toolId, toolId), eq(releases.op, "replace"), eq(releases.status, "succeeded")))
    .orderBy(desc(releases.id))
    .limit(limit);
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
