// リリースの状態機械。1 回の tick で「進められるところまで進める」。
// 直列: 同時に進めるリリースは 1 つ。Lambda(1 分ごと)でもローカルのループ(5 秒ごと)でも同じ関数を呼ぶ。
//
//   queued → building(全ツールの zip を作ってビルド)→ migrating(SQL を適用)
//          → deploying(イメージ更新。local ではファイルを書く)→ succeeded(current_release_id を進める)
import { and, eq, inArray, lte, lt, ne } from "drizzle-orm";
import { getAdapters, type ReleaseRef } from "../adapters";
import { config } from "../config";
import { platformDb } from "../db/platform";
import { releases, tools, type ReleaseRow, type ToolRow } from "../db/schema";
import { createBundleZip, mergeBundleTools } from "../services/bundle";
import { applyToolMigrations } from "../services/migrations";
import {
  activeRelease,
  currentToolFiles,
  enqueueRebuild,
  hasPendingRelease,
  latestSucceededRelease,
  liveToolFiles,
  oldestQueued,
  parsePayload,
} from "../services/releases";
import { hardDeleteTool } from "../services/tools";

const TIMEOUT_MS = 15 * 60 * 1000;
const PERIODIC_MS = 5 * 60 * 1000;

let lastPeriodicAt = 0;

export interface TickSummary {
  timedOut: number;
  processed?: { id: number; status: string };
  hardDeleted: string[];
  reconcileEnqueued: boolean;
  orphanSecrets: string[];
}

async function toolById(id: number | null): Promise<ToolRow | undefined> {
  if (id === null) return undefined;
  const [row] = await platformDb().select().from(tools).where(eq(tools.id, id)).limit(1);
  return row;
}

async function toRef(release: ReleaseRow): Promise<ReleaseRef> {
  const tool = await toolById(release.toolId);
  return {
    id: release.id,
    op: release.op,
    toolName: tool?.name,
    files: parsePayload(release),
    createdBy: release.createdBy,
    reason: release.reason,
  };
}

async function markFailed(id: number, log: string, extra: Partial<ReleaseRow> = {}): Promise<void> {
  await platformDb()
    .update(releases)
    .set({ status: "failed", log, finishedAt: new Date(), ...extra })
    .where(and(eq(releases.id, id), ne(releases.status, "succeeded")));
}

async function timeoutStale(): Promise<number> {
  const limit = new Date(Date.now() - TIMEOUT_MS);
  const [result] = await platformDb()
    .update(releases)
    .set({ status: "failed", log: "タイムアウト(15 分以内に完了しませんでした)", finishedAt: new Date() })
    .where(and(inArray(releases.status, ["building", "migrating", "deploying"]), lt(releases.startedAt, limit)));
  return result.affectedRows;
}

/** 反映が終わったら、どのリリースが現在かを台帳に書く */
async function pointCurrent(release: ReleaseRow): Promise<void> {
  if (release.toolId === null) return;
  if (release.op === "replace") {
    await platformDb().update(tools).set({ currentReleaseId: release.id }).where(eq(tools.id, release.toolId));
  } else if (release.op === "remove") {
    await platformDb().update(tools).set({ currentReleaseId: null }).where(eq(tools.id, release.toolId));
  }
}

/** building 以降を進める。終わったら true、まだ待つなら false */
async function advance(release: ReleaseRow): Promise<boolean> {
  const { builder, deployer, toolFiles } = getAdapters();
  const db = platformDb();

  if (release.status !== "building") {
    // migrating / deploying で止まっているものは再開できないので、タイムアウトに任せる
    return false;
  }

  const status = await builder.status(release.buildId ?? "");
  if (status.state === "running") {
    if (status.logUrl && !release.logUrl) await db.update(releases).set({ logUrl: status.logUrl }).where(eq(releases.id, release.id));
    return false;
  }
  if (status.state === "failed") {
    await markFailed(release.id, status.logTail || "ビルドに失敗しました", { logUrl: status.logUrl ?? null });
    return true;
  }

  const ref = await toRef(release);
  let stage = "migrating";
  try {
    await db
      .update(releases)
      .set({ status: "migrating", imageUri: status.imageUri ?? null, logUrl: status.logUrl ?? null })
      .where(eq(releases.id, release.id));

    const dumpUrls: string[] = [];
    if (release.op === "replace") {
      const tool = await toolById(release.toolId);
      if (!tool) throw new Error("ツールが見つかりません");
      const result = await applyToolMigrations(tool, ref.files ?? [], release.id);
      if (result.dumpUrl) dumpUrls.push(result.dumpUrl);
    } else if (release.op === "reconcile") {
      const liveTools = await db.select().from(tools).where(eq(tools.status, "live"));
      for (const tool of liveTools) {
        const result = await applyToolMigrations(tool, (await currentToolFiles(tool)).files, release.id);
        if (result.dumpUrl) dumpUrls.push(result.dumpUrl);
      }
    }

    stage = "deploying";
    await db
      .update(releases)
      .set({ status: "deploying", dumpUrl: dumpUrls[0] ?? null })
      .where(eq(releases.id, release.id));
    if (release.op === "replace" && ref.toolName) await toolFiles.write(ref.toolName, ref.files ?? []);
    if (release.op === "remove" && ref.toolName) await toolFiles.remove(ref.toolName);
    await deployer.deploy(status.imageUri ?? "");

    await pointCurrent(release);
    await db
      .update(releases)
      .set({ status: "succeeded", finishedAt: new Date(), log: null })
      .where(eq(releases.id, release.id));
    return true;
  } catch (err) {
    const note = stage === "deploying" ? "(マイグレーションは適用済み。デプロイで失敗)" : "(マイグレーションで失敗。適用済みのファイルは記録されています)";
    await markFailed(release.id, `${(err as Error).message} ${note}`.trim());
    return true;
  }
}

async function startNext(): Promise<ReleaseRow | undefined> {
  const db = platformDb();
  const next = await oldestQueued();
  if (!next) return undefined;
  // 条件付きで取り合う。別のワーカーが先に取っていれば 0 行
  const [claim] = await db
    .update(releases)
    .set({ status: "building", startedAt: new Date() })
    .where(and(eq(releases.id, next.id), eq(releases.status, "queued")));
  if (claim.affectedRows === 0) return undefined;

  const { bundles, builder } = getAdapters();
  try {
    const ref = await toRef(next);
    const appRef = config.appRef;
    if (!appRef) throw new Error("OKIBA_APP_REF が設定されていません");
    const bundleTools = mergeBundleTools(await liveToolFiles(), ref);
    const { key: bundleKey } = await bundles.put(next.id, createBundleZip(bundleTools));
    const { buildId } = await builder.start(ref, bundleKey, appRef);
    await db.update(releases).set({ bundleKey, appRef, buildId }).where(eq(releases.id, next.id));
    const [row] = await db.select().from(releases).where(eq(releases.id, next.id)).limit(1);
    return row;
  } catch (err) {
    await markFailed(next.id, `リリースの準備に失敗しました: ${(err as Error).message}`);
    return undefined;
  }
}

async function hardDeleteDue(): Promise<string[]> {
  const due = await platformDb()
    .select()
    .from(tools)
    .where(and(eq(tools.status, "stopped"), lte(tools.deleteScheduledAt, new Date())));
  const deleted: string[] = [];
  for (const tool of due) {
    try {
      await hardDeleteTool(tool.name);
      deleted.push(tool.name);
    } catch (err) {
      console.error(JSON.stringify({ type: "hard-delete-failed", tool: tool.name, error: (err as Error).message }));
    }
  }
  return deleted;
}

/** 基盤の ref が変わっていたら、全ツールを今の基盤で作り直す */
async function reconcileIfNeeded(): Promise<boolean> {
  if (config.OKIBA_MODE !== "aws") return false;
  if (await hasPendingRelease()) return false;
  const latest = await latestSucceededRelease();
  if (!latest) return false;
  if (latest.appRef === config.appRef) return false;
  await enqueueRebuild("okiba-worker");
  return true;
}

async function orphanSecrets(): Promise<string[]> {
  const stored = await getAdapters().secrets.listToolNames();
  const alive = new Set(
    (await platformDb().select({ name: tools.name }).from(tools).where(ne(tools.status, "deleted"))).map((r) => r.name),
  );
  const orphans = stored.filter((n) => !alive.has(n));
  if (orphans.length > 0) console.warn(JSON.stringify({ type: "orphan-secrets", tools: orphans }));
  return orphans;
}

export async function tick(): Promise<TickSummary> {
  const summary: TickSummary = { timedOut: 0, hardDeleted: [], reconcileEnqueued: false, orphanSecrets: [] };
  summary.timedOut = await timeoutStale();

  let active = await activeRelease();
  if (!active) active = await startNext();
  if (active) {
    const done = await advance(active);
    const [row] = await platformDb().select().from(releases).where(eq(releases.id, active.id)).limit(1);
    summary.processed = { id: active.id, status: done ? (row?.status ?? "unknown") : row?.status ?? "building" };
  }

  summary.hardDeleted = await hardDeleteDue();

  if (Date.now() - lastPeriodicAt > PERIODIC_MS) {
    lastPeriodicAt = Date.now();
    try {
      summary.reconcileEnqueued = await reconcileIfNeeded();
    } catch (err) {
      console.error(JSON.stringify({ type: "reconcile-failed", error: (err as Error).message }));
    }
    try {
      summary.orphanSecrets = await orphanSecrets();
    } catch (err) {
      console.error(JSON.stringify({ type: "orphan-check-failed", error: (err as Error).message }));
    }
  }
  return summary;
}
