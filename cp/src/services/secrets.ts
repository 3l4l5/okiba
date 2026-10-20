// ツールごとの認証情報。値は Parameter Store(local ではファイル)にだけ置き、台帳にはキー名と更新日時だけ持つ。
import { and, eq } from "drizzle-orm";
import { getAdapters } from "../adapters";
import { platformDb } from "../db/platform";
import { toolSecrets, type ToolRow, type ToolSecretRow } from "../db/schema";
import { ApiError } from "../lib/errors";

export const SECRET_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
export const SECRET_VALUE_MAX = 4096;

export function validateSecretKey(key: string): void {
  if (!SECRET_KEY_PATTERN.test(key)) {
    throw new ApiError(400, "キー名は大文字の英字で始まり、英大文字・数字・アンダースコアで 2〜64 文字にしてください(例: SLACK_TOKEN)");
  }
}

export function validateSecretValue(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > SECRET_VALUE_MAX) {
    throw new ApiError(400, `値は 1〜${SECRET_VALUE_MAX} 文字の文字列にしてください`);
  }
}

export async function listSecrets(tool: ToolRow): Promise<ToolSecretRow[]> {
  return platformDb().select().from(toolSecrets).where(eq(toolSecrets.toolId, tool.id)).orderBy(toolSecrets.keyName);
}

export async function listSecretKeys(tool: ToolRow): Promise<string[]> {
  return (await listSecrets(tool)).map((s) => s.keyName);
}

export async function putSecret(tool: ToolRow, key: string, value: string, by: string): Promise<void> {
  validateSecretKey(key);
  validateSecretValue(value);
  await getAdapters().secrets.put(tool.name, key, value);
  await platformDb()
    .insert(toolSecrets)
    .values({ toolId: tool.id, keyName: key, updatedBy: by })
    .onDuplicateKeyUpdate({ set: { updatedBy: by, updatedAt: new Date() } });
}

export async function deleteSecret(tool: ToolRow, key: string): Promise<void> {
  validateSecretKey(key);
  await getAdapters().secrets.delete(tool.name, key);
  await platformDb()
    .delete(toolSecrets)
    .where(and(eq(toolSecrets.toolId, tool.id), eq(toolSecrets.keyName, key)));
}

export async function deleteAllSecrets(tool: ToolRow): Promise<void> {
  await getAdapters().secrets.deleteAll(tool.name);
  await platformDb().delete(toolSecrets).where(eq(toolSecrets.toolId, tool.id));
}
