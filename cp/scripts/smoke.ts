// ローカルモードの通し確認。MySQL(docker compose)と platform のマイグレーションが済んでいる前提。
//   npm run db:migrate -w cp && npx tsx cp/scripts/smoke.ts
// 作成 → tick → アップロード(版ずれは 409)→ tick → 戻す → tick → 停止 → tick → 完全削除 まで流し、
// ファイル・テーブル・認証情報・current_release_id が期待どおりに動くことを確かめる。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { getAdapters } from "../src/adapters";
import { config } from "../src/config";
import { platformDb } from "../src/db/platform";
import { toolsDb, toolsDbName } from "../src/db/tools-db";
import { ApiError } from "../src/lib/errors";
import { currentToolFiles, listReleases } from "../src/services/releases";
import { listSecrets, putSecret } from "../src/services/secrets";
import { createTool, getTool, hardDeleteTool, rollbackTool, stopTool } from "../src/services/tools";
import { handleUpload } from "../src/services/uploads";
import { tick } from "../src/worker/tick";

const NAME = "smoke-memo";
const OWNER = "smoke@example.com";

async function tableNames(prefix: string): Promise<string[]> {
  const [rows] = await toolsDb().query<RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE ?",
    [toolsDbName(), `${prefix}%`],
  );
  return rows.map((r) => r.name as string).sort();
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  assert.equal(config.OKIBA_MODE, "local", "smoke は local モードで実行してください");
  const toolDir = path.join(config.repoRoot, "app", "app", "tools", NAME);
  const trashDir = path.join(config.localStateDir, "trash", NAME);
  const prefix = "smoke_memo_";

  // 前回の残りを掃除
  await fs.rm(toolDir, { recursive: true, force: true });
  await fs.rm(trashDir, { recursive: true, force: true });
  const existing = await getTool(NAME);
  if (existing) {
    await platformDb().execute(`DELETE FROM releases WHERE tool_id = ${existing.id}`);
    await platformDb().execute(`DELETE FROM migrations WHERE tool_id = ${existing.id}`);
    await platformDb().execute(`DELETE FROM tool_secrets WHERE tool_id = ${existing.id}`);
    await platformDb().execute(`DELETE FROM upload_tokens WHERE tool_id = ${existing.id}`);
    await platformDb().execute(`DELETE FROM tools WHERE id = ${existing.id}`);
  }
  for (const t of await tableNames(prefix)) await toolsDb().query(`DROP TABLE IF EXISTS \`${t}\``);
  await getAdapters().secrets.deleteAll(NAME);

  // 1. 作成 → tick で反映
  let tool = await createTool({ name: NAME, description: "smoke test", owner: OWNER });
  assert.equal(tool.status, "live");
  assert.equal(tool.currentReleaseId, null);
  let summary = await tick();
  console.log("tick(create):", JSON.stringify(summary));
  assert.equal(summary.processed?.status, "succeeded");
  assert.ok(await exists(path.join(toolDir, "page.tsx")), "page.tsx が書かれていない");
  const tablesAfterCreate = await tableNames(prefix);
  console.log("tables after create:", tablesAfterCreate);
  assert.ok(tablesAfterCreate.length > 0, "ひな形のマイグレーションでテーブルが作られていない");
  tool = (await getTool(NAME))!;
  const createRelease = (await listReleases(tool.id))[0];
  assert.equal(createRelease?.reason, "create");
  assert.ok(createRelease?.dumpUrl, "マイグレーション前のダンプが記録されていない");
  assert.equal(tool.currentReleaseId, createRelease.id, "current_release_id が作成リリースを指していない");
  assert.equal(createRelease.appRef, "local");

  // 2. 認証情報
  await putSecret(tool, "SMOKE_KEY", "secret-value", OWNER);
  assert.deepEqual((await listSecrets(tool)).map((s) => s.keyName), ["SMOKE_KEY"]);
  assert.deepEqual(await getAdapters().secrets.list(NAME), ["SMOKE_KEY"]);

  // 3. アップロード。版ずれは 409、合っていれば queued → tick で置き換わる
  const current = await currentToolFiles(tool);
  assert.equal(current.baseVersion, String(createRelease.id));
  assert.ok(current.files.some((f) => f.path === "page.tsx"));
  await assert.rejects(
    handleUpload(tool, { baseVersion: "0", files: [{ path: "page.tsx", content: "x" }] }, OWNER),
    (err: unknown) => err instanceof ApiError && err.status === 409,
  );
  const uploaded = await handleUpload(
    tool,
    {
      baseVersion: current.baseVersion,
      files: [{ path: "page.tsx", content: "export default function Page() { return <p>SMOKE_V2</p>; }" }],
    },
    OWNER,
  );
  summary = await tick();
  console.log("tick(upload):", JSON.stringify(summary));
  assert.equal(summary.processed?.id, uploaded.releaseId);
  assert.equal(summary.processed?.status, "succeeded");
  assert.match(await fs.readFile(path.join(toolDir, "page.tsx"), "utf8"), /SMOKE_V2/);
  assert.ok(!(await exists(path.join(toolDir, "actions.ts"))), "送らなかったファイルが残っている");
  tool = (await getTool(NAME))!;
  assert.equal(tool.currentReleaseId, uploaded.releaseId);

  // 4. 戻す → ひな形の内容に戻る
  await rollbackTool(NAME, OWNER);
  summary = await tick();
  console.log("tick(rollback):", JSON.stringify(summary));
  assert.equal(summary.processed?.status, "succeeded");
  assert.ok(await exists(path.join(toolDir, "actions.ts")), "戻したのに actions.ts がない");
  assert.doesNotMatch(await fs.readFile(path.join(toolDir, "page.tsx"), "utf8"), /SMOKE_V2/);
  tool = (await getTool(NAME))!;
  assert.notEqual(tool.currentReleaseId, uploaded.releaseId);

  // 5. 停止 → tick でディレクトリが退避される
  await stopTool(NAME, OWNER);
  summary = await tick();
  console.log("tick(stop):", JSON.stringify(summary));
  assert.equal(summary.processed?.status, "succeeded");
  assert.ok(!(await exists(toolDir)), "停止後もディレクトリが残っている");
  assert.ok(await exists(path.join(trashDir, "page.tsx")), "退避先にファイルがない");
  tool = (await getTool(NAME))!;
  assert.equal(tool.status, "stopped");
  assert.equal(tool.currentReleaseId, null);
  assert.deepEqual(await tableNames(prefix), tablesAfterCreate, "停止でテーブルが消えてはいけない");

  // 6. 完全削除
  await hardDeleteTool(NAME);
  assert.equal((await getTool(NAME))?.status, "deleted");
  assert.deepEqual(await tableNames(prefix), [], "テーブルが消えていない");
  assert.deepEqual(await getAdapters().secrets.list(NAME), [], "認証情報が消えていない");

  // 7. 削除済みの名前は再利用できない
  await assert.rejects(createTool({ name: NAME, description: "again", owner: OWNER }), /使われています/);

  // 掃除
  await fs.rm(trashDir, { recursive: true, force: true });
  console.log("smoke: OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke: FAILED", err);
  process.exit(1);
});
