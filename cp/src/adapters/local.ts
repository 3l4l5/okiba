// local モード。GitHub も AWS も使わず、ツールアプリのディレクトリに直接書く。
// ツールアプリの dev サーバーがファイルの変化を拾うので、アップロードがそのまま反映される。
import fs from "node:fs/promises";
import path from "node:path";
import type { UploadFile } from "@okiba/shared";
import { config } from "../config";
import { hashFiles, pathExists, readDirAsFiles, writeFilesToDir } from "./files";
import type {
  Builder,
  Deployer,
  DumpStore,
  LogReader,
  ReleaseRef,
  SecretStore,
  SourceStore,
  ToolSnapshot,
} from "./types";

function toolsRoot(): string {
  return path.join(config.repoRoot, ...config.toolsDirInRepo.split("/"));
}

function toolDir(name: string): string {
  return path.join(toolsRoot(), name);
}

function trashDir(name: string): string {
  return path.join(config.localStateDir, "trash", name);
}

export class LocalSourceStore implements SourceStore {
  async readTool(name: string): Promise<ToolSnapshot> {
    const files = await readDirAsFiles(toolDir(name));
    return { files, baseSha: hashFiles(files) };
  }

  async readToolAt(name: string, commitSha: string): Promise<UploadFile[]> {
    // 履歴は持たないので、停止時に退避したものだけ読める
    const trash = trashDir(name);
    if (await pathExists(trash)) return readDirAsFiles(trash);
    throw new Error(`ローカルモードでは過去の内容(${commitSha})を取り出せません`);
  }

  async prepareRelease(release: ReleaseRef): Promise<{ commitSha: string }> {
    if (release.op === "reconcile") return { commitSha: await this.headSha() };
    if (!release.toolName) throw new Error("toolName がありません");
    if (release.op === "remove") {
      const dir = toolDir(release.toolName);
      if (await pathExists(dir)) {
        const trash = trashDir(release.toolName);
        await fs.mkdir(path.dirname(trash), { recursive: true });
        await fs.rm(trash, { recursive: true, force: true });
        await fs.rename(dir, trash);
      }
      return { commitSha: `removed-${release.id}` };
    }
    const files = release.files ?? [];
    await writeFilesToDir(toolDir(release.toolName), files);
    return { commitSha: hashFiles(files) };
  }

  async promote(): Promise<void> {}

  async discard(): Promise<void> {}

  async headSha(): Promise<string> {
    const root = toolsRoot();
    const all: UploadFile[] = [];
    let names: string[] = [];
    try {
      names = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return "empty";
    }
    for (const name of names.sort()) {
      for (const f of await readDirAsFiles(path.join(root, name))) all.push({ ...f, path: `${name}/${f.path}` });
    }
    return hashFiles(all);
  }

  async downloadZip(): Promise<Buffer> {
    throw new Error("ローカルモードではビルド用の zip を作れません");
  }
}

export class NoopBuilder implements Builder {
  async start(): Promise<{ buildId: string }> {
    return { buildId: "local" };
  }
  async status() {
    return { state: "succeeded" as const, imageUri: "local" };
  }
}

export class NoopDeployer implements Deployer {
  async deploy(): Promise<void> {}
}

type SecretsFile = Record<string, Record<string, string>>;

export class LocalSecretStore implements SecretStore {
  private get file(): string {
    return config.localSecretsFile;
  }

  private async read(): Promise<SecretsFile> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as SecretsFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private async write(data: SecretsFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  }

  async list(toolName: string): Promise<string[]> {
    const data = await this.read();
    return Object.keys(data[toolName] ?? {}).sort();
  }

  async put(toolName: string, key: string, value: string): Promise<void> {
    const data = await this.read();
    data[toolName] = { ...(data[toolName] ?? {}), [key]: value };
    await this.write(data);
  }

  async delete(toolName: string, key: string): Promise<void> {
    const data = await this.read();
    if (data[toolName]) {
      delete data[toolName][key];
      if (Object.keys(data[toolName]).length === 0) delete data[toolName];
    }
    await this.write(data);
  }

  async deleteAll(toolName: string): Promise<void> {
    const data = await this.read();
    delete data[toolName];
    await this.write(data);
  }

  async listToolNames(): Promise<string[]> {
    return Object.keys(await this.read()).sort();
  }
}

export class LocalDumpStore implements DumpStore {
  async putDump(toolName: string, releaseId: number | "delete", sql: string): Promise<{ url: string }> {
    const dir = path.join(config.localStateDir, "dumps", toolName);
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${releaseId}.sql`);
    await fs.writeFile(file, sql);
    return { url: file };
  }
}

export class LocalLogReader implements LogReader {
  async tail(): Promise<string[]> {
    return ["ローカルモードでは実行時ログは取得できません。ツールアプリの端末出力を見てください"];
  }
}
