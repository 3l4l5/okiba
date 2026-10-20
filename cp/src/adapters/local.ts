// local モード。AWS を使わず、ツールアプリのディレクトリに直接書く。
// ツールアプリの dev サーバーがファイルの変化を拾うので、リリースがそのまま反映される。
import fs from "node:fs/promises";
import path from "node:path";
import type { UploadFile } from "@okiba/shared";
import { config } from "../config";
import { pathExists, writeFilesToDir } from "./files";
import type { Builder, BundleStore, Deployer, DumpStore, LogReader, SecretStore, ToolFiles } from "./types";

function toolDir(name: string): string {
  return path.join(config.repoRoot, ...config.toolsDirInRepo.split("/"), name);
}

function trashDir(name: string): string {
  return path.join(config.localStateDir, "trash", name);
}

/** ディレクトリを置き換える / 退避する。退避先は復元の正本ではなく(正本は DB)、手元で見返すためのもの */
export class LocalToolFiles implements ToolFiles {
  async write(toolName: string, files: UploadFile[]): Promise<void> {
    await writeFilesToDir(toolDir(toolName), files);
  }

  async remove(toolName: string): Promise<void> {
    const dir = toolDir(toolName);
    if (!(await pathExists(dir))) return;
    const trash = trashDir(toolName);
    await fs.mkdir(path.dirname(trash), { recursive: true });
    await fs.rm(trash, { recursive: true, force: true });
    await fs.rename(dir, trash);
  }
}

/** ローカルではビルドしないので zip は作らない */
export class NoopBundleStore implements BundleStore {
  async put(): Promise<{ key: string }> {
    return { key: "local" };
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
