// 基盤ファイル。処理中のリクエストがどのツールのものかを取る。
import { headers } from "next/headers";
import { toTablePrefix } from "@okiba/shared";

/** 今のリクエストのツール名(/tools/<name> の name)。middleware が付ける */
export async function getCurrentToolName(): Promise<string> {
  const h = await headers();
  const name = h.get("x-okiba-tool");
  if (!name) {
    throw new Error("ツール名が分かりません(/tools/<name> の外から呼ばれています)");
  }
  return name;
}

/** テーブル名の接頭語。visit-memo → visit_memo_ */
export function tablePrefix(name: string): string {
  return toTablePrefix(name);
}
