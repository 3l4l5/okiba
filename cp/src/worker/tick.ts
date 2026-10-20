// リリースの状態機械。1 回の tick で「進められるところまで進める」。
// 直列: 同時に進めるリリースは 1 つ。Lambda(1 分ごと)でもローカルのループ(5 秒ごと)でも同じ関数を呼ぶ。
import { and, desc, eq, inArray, lte, lt, ne } from "drizzle-orm";
import { getAdapters, type ReleaseRef } from "../adapters";
import { config } from "../config";
import { platformDb } from "../db/platform";
import { releases, tools, type ReleaseRow, type ToolRow } from "../db/schema";
import { applyToolMigrations } from "../services/migrations";
import { activeRelease, hasPendingRelease, oldestQueued, parsePayload } from "../services/releases";
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

/** building 以降を進める。終わったら true、まだ待つなら false */
async function advance(release: ReleaseRow): Promise<boolean> {
  const { builder, source, deployer } = getAdapters();
  const db = platformDb();
  const ref = await toRef(release);

  if (release.status === "building") {
    const status = await builder.status(release.buildId ?? "");
    if (status.state === "running") {
      if (status.logUrl && !release.logUrl) await db.update(releases).set({ logUrl: status.logUrl }).where(eq(releases.id, release.id));
      return false;
    }
    if (status.state === "failed") {
      await markFailed(release.id, status.logTail || "ビルドに失敗しました", { logUrl: status.logUrl ?? null });
      await source.discard(release.branch ?? undefined);
      return true;
    }
    let promoted = false;
    try {
      await source.promote(ref, release.commitSha ?? "", release.branch ?? undefined);
      promoted = true;
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
          const files = await source.readToolAt(tool.name, release.commitSha ?? "");
          const result = await applyToolMigrations(tool, files, release.id);
          if (result.dumpUrl) dumpUrls.push(result.dumpUrl);
        }
      }

      await db
        .update(releases)
        .set({ status: "deploying", dumpUrl: dumpUrls[0] ?? null })
        .where(eq(releases.id, release.id));
      await deployer.deploy(status.imageUri ?? "");
      await db
        .update(releases)
        .set({ status: "succeeded", finishedAt: new Date(), log: null })
        .where(eq(releases.id, release.id));
      return true;
    } catch (err) {
      const message = (err as Error).message;
      const note = promoted ? "(コードは main に取り込み済み。マイグレーションかデプロイで失敗)" : "";
      await markFailed(release.id, `${message} ${note}`.trim());
      if (!promoted) await source.discard(release.branch ?? undefined);
      return true;
    }
  }
  // migrating / deploying で止まっているものは再開できないので、タイムアウトに任せる
  return false;
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

  const { source, builder } = getAdapters();
  try {
    const ref = await toRef(next);
    const prepared = await source.prepareRelease(ref);
    const { buildId } = await builder.start(ref, prepared.commitSha);
    await db
      .update(releases)
      .set({ commitSha: prepared.commitSha, branch: prepared.branch ?? null, buildId })
      .where(eq(releases.id, next.id));
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

async function reconcileIfNeeded(): Promise<boolean> {
  if (config.OKIBA_MODE !== "aws") return false;
  if (await hasPendingRelease()) return false;
  const head = await getAdapters().source.headSha();
  const [latest] = await platformDb()
    .select()
    .from(releases)
    .where(eq(releases.status, "succeeded"))
    .orderBy(desc(releases.id))
    .limit(1);
  if (latest?.commitSha === head) return false;
  await platformDb().insert(releases).values({ toolId: null, op: "reconcile", reason: "reconcile", createdBy: "okiba-worker" });
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
