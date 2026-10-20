// AI からアップロードされるファイル一式の検証。
// パスはツールのディレクトリ(app/app/tools/<name>/)からの相対パス。

export interface UploadFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export const MAX_UPLOAD_FILES = 200;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PATH_LENGTH = 200;

/** ファイル名そのものが禁止(大文字小文字は区別しない) */
export const FORBIDDEN_BASENAMES: ReadonlySet<string> = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "dockerfile",
  "middleware.ts",
  "middleware.js",
  "proxy.ts",
  "proxy.js",
  ".npmrc",
  "tsconfig.json",
]);

/** この文字列で始まるファイル名は禁止 */
export const FORBIDDEN_BASENAME_PREFIXES = [".env", "next.config."];

/** パスのどこかにこのディレクトリがあれば禁止 */
export const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  ".github",
  "node_modules",
  ".okiba",
  ".git",
  ".next",
]);

/** 認証情報らしい文字列。値は 7.8 の仕組み(Parameter Store)で渡す */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "AWS アクセスキー", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "OpenAI / Anthropic 形式のキー", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "秘密鍵", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub トークン", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "Slack トークン", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Google API キー", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
];

export function isTextPath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|md|css|txt|yaml|yml|svg|html)$/i.test(path);
}

export function decodeContent(file: UploadFile): Buffer {
  return file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content, "utf8");
}

export function validateUploadPath(path: string): string | null {
  if (!path || path.length > MAX_PATH_LENGTH) return `パスが空か長すぎます: ${path}`;
  if (path.startsWith("/") || path.includes("\\")) return `絶対パスとバックスラッシュは使えません: ${path}`;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return `パスに制御文字が含まれています: ${path}`;
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return `パスに空のセグメントや ".." は使えません: ${path}`;
    if (FORBIDDEN_SEGMENTS.has(seg)) return `ディレクトリ ${seg} はアップロードできません: ${path}`;
  }
  const base = segments[segments.length - 1];
  const lower = base.toLowerCase();
  if (FORBIDDEN_BASENAMES.has(lower)) return `${base} は基盤ファイルのためアップロードできません: ${path}`;
  for (const prefix of FORBIDDEN_BASENAME_PREFIXES) {
    if (lower.startsWith(prefix)) return `${base} は基盤ファイルのためアップロードできません: ${path}`;
  }
  return null;
}

export function findSecretLike(text: string): string | null {
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(text)) return p.name;
  }
  return null;
}

export interface UploadValidationResult {
  errors: string[];
  totalBytes: number;
}

export function validateUploadFiles(files: UploadFile[]): UploadValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(files) || files.length === 0) {
    return { errors: ["ファイルが 1 つもありません"], totalBytes: 0 };
  }
  if (files.length > MAX_UPLOAD_FILES) {
    errors.push(`ファイル数が上限(${MAX_UPLOAD_FILES})を超えています: ${files.length}`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      errors.push("path と content は文字列で指定してください");
      continue;
    }
    if (file.encoding && file.encoding !== "utf8" && file.encoding !== "base64") {
      errors.push(`encoding は utf8 か base64 です: ${file.path}`);
    }
    const pathError = validateUploadPath(file.path);
    if (pathError) errors.push(pathError);
    if (seen.has(file.path)) errors.push(`同じパスが重複しています: ${file.path}`);
    seen.add(file.path);

    const bytes = decodeContent(file);
    totalBytes += bytes.length;
    if (isTextPath(file.path)) {
      const hit = findSecretLike(bytes.toString("utf8"));
      if (hit) errors.push(`${file.path} に ${hit} らしい文字列があります。認証情報は管理画面から登録してください`);
    }
  }
  if (totalBytes > MAX_UPLOAD_BYTES) {
    errors.push(`合計サイズが上限(${MAX_UPLOAD_BYTES} bytes)を超えています: ${totalBytes}`);
  }
  if (!files.some((f) => f.path === "page.tsx")) {
    errors.push("page.tsx がありません(/tools/<name> の画面になります)");
  }
  return { errors, totalBytes };
}
