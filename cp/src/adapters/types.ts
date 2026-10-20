// デプロイ先に依存する部分の境界。local は手元で全部動かすため、aws は本番用。
import type { UploadFile } from "@okiba/shared";
import type { ReleaseOp } from "../db/schema";

/** リリース処理に必要な最小限の情報 */
export interface ReleaseRef {
  id: number;
  op: ReleaseOp;
  toolName?: string;
  files?: UploadFile[];
  createdBy: string;
  reason: string;
}

export interface ToolSnapshot {
  files: UploadFile[];
  /** ツールのディレクトリの内容を表す値。内容が変わらなければ変わらない。無ければ 'empty' */
  baseSha: string;
}

export interface SourceStore {
  /** main の現在の内容 */
  readTool(name: string): Promise<ToolSnapshot>;
  /** 指定のコミット時点の内容 */
  readToolAt(name: string, commitSha: string): Promise<UploadFile[]>;
  /** リリースの内容を main の先頭に乗せたコミット(とブランチ)を作る */
  prepareRelease(release: ReleaseRef): Promise<{ commitSha: string; branch?: string }>;
  /** ビルドが通ったら main を進める。main が先に進んでいたら乗せ直す */
  promote(release: ReleaseRef, commitSha: string, branch?: string): Promise<void>;
  /** ビルドに失敗したブランチを消す */
  discard(branch?: string): Promise<void>;
  /** main の先頭 */
  headSha(): Promise<string>;
  /** ビルドに渡す zip */
  downloadZip(commitSha: string): Promise<Buffer>;
}

export interface BuildStatus {
  state: "running" | "succeeded" | "failed";
  imageUri?: string;
  logUrl?: string;
  logTail?: string;
}

export interface Builder {
  start(release: ReleaseRef, commitSha: string): Promise<{ buildId: string }>;
  status(buildId: string): Promise<BuildStatus>;
}

export interface Deployer {
  deploy(imageUri: string): Promise<void>;
}

export interface SecretStore {
  list(toolName: string): Promise<string[]>;
  put(toolName: string, key: string, value: string): Promise<void>;
  delete(toolName: string, key: string): Promise<void>;
  deleteAll(toolName: string): Promise<void>;
  /** 認証情報を持っているツール名の一覧(棚卸し用) */
  listToolNames(): Promise<string[]>;
}

export interface DumpStore {
  putDump(toolName: string, releaseId: number | "delete", sql: string): Promise<{ url: string }>;
}

export interface LogReader {
  tail(toolName: string, limit: number): Promise<string[]>;
}

export interface Adapters {
  source: SourceStore;
  builder: Builder;
  deployer: Deployer;
  secrets: SecretStore;
  dumps: DumpStore;
  logs: LogReader;
}
