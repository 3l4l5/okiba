// 基盤ファイル。ツールごとの認証情報(外部 API キーなど)を取る。
// どのツールの分を返すかは、処理中のリクエストのパス(/tools/<name>)から決める。
// 引数でツール名を受け取らないので、他のツールの分は取れない。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GetParametersByPathCommand, SSMClient } from "@aws-sdk/client-ssm";
import { getCurrentToolName } from "./tool";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  values: Record<string, string>;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
let ssmClient: SSMClient | undefined;

function ssmPrefix(): string {
  return process.env.OKIBA_SSM_PREFIX ?? "/okiba";
}

async function loadFromSsm(tool: string): Promise<Record<string, string>> {
  const cached = cache.get(tool);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.values;

  ssmClient ??= new SSMClient({});
  const basePath = `${ssmPrefix()}/tools/${tool}/`;
  const values: Record<string, string> = {};
  let nextToken: string | undefined;
  do {
    const res = await ssmClient.send(
      new GetParametersByPathCommand({
        Path: basePath,
        WithDecryption: true,
        Recursive: false,
        NextToken: nextToken,
      }),
    );
    for (const p of res.Parameters ?? []) {
      if (p.Name && p.Value !== undefined) values[p.Name.slice(basePath.length)] = p.Value;
    }
    nextToken = res.NextToken;
  } while (nextToken);

  cache.set(tool, { values, fetchedAt: Date.now() });
  return values;
}

function localSecretsFile(): string {
  if (process.env.OKIBA_LOCAL_SECRETS_FILE) return process.env.OKIBA_LOCAL_SECRETS_FILE;
  // cwd が app/ のときはリポジトリのルートの .okiba/、そうでなければ cwd の .okiba/
  const cwd = process.cwd();
  const root = path.basename(cwd) === "app" ? path.resolve(cwd, "..") : cwd;
  return path.join(root, ".okiba", "secrets.json");
}

async function loadFromLocalFile(tool: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(localSecretsFile(), "utf8");
  } catch {
    return {};
  }
  const all = JSON.parse(raw) as Record<string, Record<string, string>>;
  return all[tool] ?? {};
}

async function loadSecrets(): Promise<{ tool: string; values: Record<string, string> }> {
  const tool = await getCurrentToolName();
  const mode = process.env.OKIBA_MODE ?? "local";
  const values = mode === "aws" ? await loadFromSsm(tool) : await loadFromLocalFile(tool);
  return { tool, values };
}

/** 管理画面で登録した認証情報を取る。登録されていなければエラー */
export async function getSecret(key: string): Promise<string> {
  const { tool, values } = await loadSecrets();
  const value = values[key];
  if (value === undefined) {
    throw new Error(`認証情報 ${key} はツール ${tool} に登録されていません。管理画面(CP)から登録してください`);
  }
  return value;
}

/** 登録済みのキー名の一覧(値は返さない) */
export async function listSecretKeys(): Promise<string[]> {
  const { values } = await loadSecrets();
  return Object.keys(values).sort();
}
