// AI からのアップロード。検証して、リリースをキューに入れる。
import { checkMigrationSql, toTablePrefix, validateUploadFiles, type UploadFile } from "@okiba/shared";
import { z } from "zod";
import { getAdapters } from "../adapters";
import type { ToolRow } from "../db/schema";
import { ApiError } from "../lib/errors";
import { otherPrefixes } from "./prefixes";
import { enqueueRelease } from "./releases";

export const uploadBodySchema = z.object({
  baseSha: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]).optional(),
      }),
    )
    .min(1),
});

export type UploadBody = z.infer<typeof uploadBodySchema>;

/** ファイル一式とマイグレーションの検証(純粋関数)。エラーの一覧を返す */
export function validateToolUpload(files: UploadFile[], toolName: string, otherToolPrefixes: string[]): string[] {
  const errors = [...validateUploadFiles(files).errors];
  const prefix = toTablePrefix(toolName);
  for (const file of files) {
    if (!/^migrations\/[^/]+\.sql$/.test(file.path)) continue;
    if (!/^migrations\/\d{4}_[A-Za-z0-9_-]+\.sql$/.test(file.path)) {
      errors.push(`${file.path}: マイグレーションのファイル名は migrations/0001_説明.sql の形にしてください`);
    }
    const sql = file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : file.content;
    for (const e of checkMigrationSql(sql, { prefix, otherPrefixes: otherToolPrefixes })) {
      errors.push(`${file.path}: ${e}`);
    }
  }
  return errors;
}

export async function handleUpload(tool: ToolRow, body: unknown, by: string): Promise<{ releaseId: number }> {
  if (tool.status !== "live") throw new ApiError(400, "公開中のツールにだけアップロードできます");
  const parsed = uploadBodySchema.parse(body);
  const errors = validateToolUpload(parsed.files, tool.name, await otherPrefixes(tool.name));
  if (errors.length > 0) throw new ApiError(400, "アップロードの検証に失敗しました", errors);

  const current = await getAdapters().source.readTool(tool.name);
  if (current.baseSha !== parsed.baseSha) {
    throw new ApiError(409, "ツールの内容が先に更新されています。files を取り直してからやり直してください", {
      currentBaseSha: current.baseSha,
    });
  }
  const releaseId = await enqueueRelease({ toolId: tool.id, op: "replace", reason: "upload", createdBy: by, payload: parsed.files, baseSha: parsed.baseSha });
  return { releaseId };
}
