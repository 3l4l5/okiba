// ローカルモードの通し確認。MySQL(docker compose)と platform のマイグレーションが済んでいる前提。
//   npm run db:migrate -w cp && npx tsx cp/scripts/smoke.ts
// 作成 → tick → 停止 → tick → 完全削除 まで流し、ファイル・テーブル・認証情報が期待どおりに消えることを確かめる。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { config } from "../src/config";
import { platformDb } from "../src/db/platform";
import { toolsDb, toolsDbName } from "../src/db/tools-db";
import { listSecrets, putSecret } from "../src/services/secrets";
import { createTool, getTool, hardDeleteTool, stopTool } from "../src/services/tools";
import { listReleases } from "../src/services/releases";
import { tick } from "../src/worker/tick";
import { getAdapters } from "../src/adapters";

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
  const tool = await createTool({ name: NAME, description: "smoke test", owner: OWNER });
  assert.equal(tool.status, "live");
  let summary = await tick();
  console.log("tick(create):", JSON.stringify(summary));
  assert.equal(summary.processed?.status, "succeeded");
  assert.ok(await exists(path.join(toolDir, "page.tsx")), "page.tsx が書かれていない");
  const tablesAfterCreate = await tableNames(prefix);
  console.log("tables after create:", tablesAfterCreate);
  assert.ok(tablesAfterCreate.length > 0, "ひな形のマイグレーションでテーブルが作られていない");
  const releasesAfterCreate = await listReleases(tool.id);
  assert.equal(releasesAfterCreate[0]?.reason, "create");
  assert.ok(releasesAfterCreate[0]?.dumpUrl, "マイグレーション前のダンプが記録されていない");

  // 2. 認証情報
  await putSecret(tool, "SMOKE_KEY", "secret-value", OWNER);
  assert.deepEqual((await listSecrets(tool)).map((s) => s.keyName), ["SMOKE_KEY"]);
  assert.deepEqual(await getAdapters().secrets.list(NAME), ["SMOKE_KEY"]);

  // 3. 停止 → tick でディレクトリが退避される
  await stopTool(NAME, OWNER);
  summary = await tick();
  console.log("tick(stop):", JSON.stringify(summary));
  assert.equal(summary.processed?.status, "succeeded");
  assert.ok(!(await exists(toolDir)), "停止後もディレクトリが残っている");
  assert.ok(await exists(path.join(trashDir, "page.tsx")), "退避先にファイルがない");
  assert.equal((await getTool(NAME))?.status, "stopped");
  assert.deepEqual(await tableNames(prefix), tablesAfterCreate, "停止でテーブルが消えてはいけない");

  // 4. 完全削除
  await hardDeleteTool(NAME);
  assert.equal((await getTool(NAME))?.status, "deleted");
  assert.deepEqual(await tableNames(prefix), [], "テーブルが消えていない");
  assert.deepEqual(await getAdapters().secrets.list(NAME), [], "認証情報が消えていない");
  assert.deepEqual(await getAdapters().secrets.listToolNames(), (await getAdapters().secrets.listToolNames()).filter((n) => n !== NAME));

  // 5. 削除済みの名前は再利用できない
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
