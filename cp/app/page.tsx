import Link from "next/link";
import { config } from "@/src/config";
import { getCurrentUser, isAdmin } from "@/src/lib/auth";
import { listTools } from "@/src/services/tools";
import { rebuildAction } from "./actions";
import { StatusBadge } from "./components/StatusBadge";
import { formatDate } from "./components/format";
import { ActionButton } from "./tools/[name]/ActionButton";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    return <p className="error">ログインが必要です。SSO を通してアクセスしてください。</p>;
  }
  const items = await listTools();
  return (
    <>
      <h1>ツール一覧</h1>
      <div className="toolbar">
        <Link href="/tools/new" className="button primary">
          新しいツール
        </Link>
        {isAdmin(user.email) && (
          <ActionButton
            label="再ビルド"
            confirm={`すべてのツールを今の基盤(${config.appRef || "未設定"})で作り直します。よろしいですか?`}
            action={rebuildAction}
          />
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>名前</th>
            <th>説明</th>
            <th>作成者</th>
            <th>状態</th>
            <th>最終リリース</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                まだツールがありません
              </td>
            </tr>
          )}
          {items.map((t) => (
            <tr key={t.id}>
              <td>
                <Link href={`/tools/${t.name}`}>{t.name}</Link>
                <br />
                {t.status === "live" && (
                  <a href={t.url} target="_blank" rel="noreferrer" className="muted">
                    開く ↗
                  </a>
                )}
              </td>
              <td>{t.description}</td>
              <td>{t.owner}</td>
              <td>
                <StatusBadge status={t.status} />
              </td>
              <td>
                {t.lastRelease ? (
                  <>
                    <StatusBadge status={t.lastRelease.status} />
                    <div className="muted">{formatDate(t.lastRelease.createdAt)}</div>
                  </>
                ) : (
                  "-"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
