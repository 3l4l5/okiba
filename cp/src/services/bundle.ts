// ビルドに渡す「全ツールの zip」。基盤のコード(GitHub、読み取り専用)の app/app/tools/ に重ねる。
// zip には <name>/ のディレクトリだけを入れ、基盤ファイル(layout.tsx など)には触れない。
import type { UploadFile } from "@okiba/shared";
import { decodeContent } from "@okiba/shared";
import { unzipSync, zipSync } from "fflate";

export interface BundleTool {
  name: string;
  files: UploadFile[];
}

export const BUNDLE_ROOT = "app/app/tools";

/** zip のエントリ(パス → 内容)を作る(純粋関数) */
export function bundleEntries(tools: BundleTool[]): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const tool of [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    for (const file of tool.files) {
      entries[`${BUNDLE_ROOT}/${tool.name}/${file.path}`] = new Uint8Array(decodeContent(file));
    }
  }
  return entries;
}

export function createBundleZip(tools: BundleTool[]): Buffer {
  return Buffer.from(zipSync(bundleEntries(tools), { level: 6 }));
}

/**
 * ビルドに渡す全ツールの内容(純粋関数)。公開中のツールの反映済みコードに、このリリースの変更を重ねる。
 * replace: 対象ツールは新しい payload に差し替える / remove: 対象ツールを外す / reconcile: そのまま
 */
export function mergeBundleTools(
  live: BundleTool[],
  release: { op: "replace" | "remove" | "reconcile"; toolName?: string; files?: UploadFile[] },
): BundleTool[] {
  if (release.op === "reconcile" || !release.toolName) return live;
  const others = live.filter((t) => t.name !== release.toolName);
  if (release.op === "remove") return others;
  return [...others, { name: release.toolName, files: release.files ?? [] }];
}

/** テストと確認用。zip の中のパス一覧 */
export function listBundleZip(zip: Buffer): string[] {
  return Object.keys(unzipSync(new Uint8Array(zip))).sort();
}

/** IMAGE_TAG に使える形にする(ECR のタグは英数字と _ . - のみ) */
export function imageTagFor(releaseId: number, appRef: string): string {
  const short = appRef.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 40) || "ref";
  return `${releaseId}-${short}`;
}
