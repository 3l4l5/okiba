// ファイル一式の読み書きとハッシュ。local アダプタとテンプレートの読み込みで使う。
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { UploadFile } from "@okiba/shared";

/** ディレクトリ以下を相対パスで読む。存在しなければ空 */
export async function readDirAsFiles(root: string): Promise<UploadFile[]> {
  const files: UploadFile[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        files.push({ path: rel, content: (await fs.readFile(full)).toString("base64"), encoding: "base64" });
      }
    }
  }
  await walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** ディレクトリを丸ごと置き換える */
export async function writeFilesToDir(root: string, files: UploadFile[]): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  for (const file of files) {
    const full = path.join(root, ...file.path.split("/"));
    await fs.mkdir(path.dirname(full), { recursive: true });
    const data = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
    await fs.writeFile(full, data);
  }
}

/** 内容が同じなら同じ値になるハッシュ */
export function hashFiles(files: UploadFile[]): string {
  if (files.length === 0) return "empty";
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const data = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
    hash.update(file.path).update("\0").update(data).update("\0");
  }
  return hash.digest("hex");
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
