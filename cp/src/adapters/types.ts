// デプロイ先に依存する部分の境界。local は手元で全部動かすため、aws は本番用。
// ツールのコードの正本は DB(releases.payload)なので、ここにソース管理はない。
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

/** ビルドに渡す「全ツールの zip」の置き場所 */
export interface BundleStore {
  put(releaseId: number, zip: Buffer): Promise<{ key: string }>;
}

export interface BuildStatus {
  state: "running" | "succeeded" | "failed";
  imageUri?: string;
  logUrl?: string;
  logTail?: string;
}

export interface Builder {
  /** 基盤のコード(appRef)にツールの zip(bundleKey)を重ねてイメージを作る */
  start(release: ReleaseRef, bundleKey: string, appRef: string): Promise<{ buildId: string }>;
  status(buildId: string): Promise<BuildStatus>;
}

export interface Deployer {
  deploy(imageUri: string): Promise<void>;
}

/**
 * ツールのファイルを実行環境に置く。local ではツールアプリのディレクトリに直接書くのがデプロイそのもの。
 * aws ではイメージに焼き込まれるので何もしない。
 */
export interface ToolFiles {
  write(toolName: string, files: UploadFile[]): Promise<void>;
  remove(toolName: string): Promise<void>;
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
  bundles: BundleStore;
  builder: Builder;
  deployer: Deployer;
  toolFiles: ToolFiles;
  secrets: SecretStore;
  dumps: DumpStore;
  logs: LogReader;
}
