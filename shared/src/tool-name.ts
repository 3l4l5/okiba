// ツール名は URL(/tools/<name>)、ディレクトリ、テーブルの接頭語、
// Parameter Store のパスのすべてに使う。ここで決めた形以外は受け付けない。

export const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "api",
  "_next",
  "next",
  "static",
  "public",
  "tools",
  "tool",
  "admin",
  "login",
  "logout",
  "auth",
  "health",
  "healthz",
  "favicon",
  "robots",
  "sitemap",
  "okiba",
  "cp",
  "platform",
  "migrations",
  "lib",
  "test",
  "www",
]);

/** 不正ならエラーメッセージ、正しければ null を返す */
export function validateToolName(name: string): string | null {
  if (!TOOL_NAME_PATTERN.test(name)) {
    return "ツール名は英小文字・数字・ハイフンで 3〜32 文字、先頭と末尾は英数字にしてください";
  }
  if (name.includes("--")) {
    return "ツール名にハイフンを連続させることはできません";
  }
  if (RESERVED_TOOL_NAMES.has(name)) {
    return `「${name}」は予約語のため使えません`;
  }
  return null;
}

/** テーブル名の接頭語。visit-memo → visit_memo_ */
export function toTablePrefix(name: string): string {
  return `${name.replace(/-/g, "_")}_`;
}
