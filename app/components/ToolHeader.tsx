// 基盤ファイル。すべてのツールの上に出る共通ヘッダー。
import { headers } from "next/headers";

export default async function ToolHeader() {
  const h = await headers();
  const tool = h.get("x-okiba-tool") ?? "";
  const email = h.get("x-okiba-user-email") ?? "";
  const cpUrl = process.env.OKIBA_CP_URL ?? "http://localhost:3000";

  return (
    <header className="okiba-header">
      <a href={`${cpUrl}/tools/${encodeURIComponent(tool)}`}>一覧に戻る</a>
      <span className="tool-name">{tool}</span>
      <span className="spacer" />
      <span className="user">{email}</span>
    </header>
  );
}
