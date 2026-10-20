import Link from "next/link";
import { notFound } from "next/navigation";
import { config } from "@/src/config";
import { canEdit, canManage, getCurrentUser, isAdmin } from "@/src/lib/auth";
import { listReleases } from "@/src/services/releases";
import { listSecrets } from "@/src/services/secrets";
import { getEditors, getTool, toolUrl } from "@/src/services/tools";
import { StatusBadge } from "../../components/StatusBadge";
import { formatDate } from "../../components/format";
import { ActionButton } from "./ActionButton";
import { FormWithState } from "./FormWithState";
import { PromptIssuer } from "./PromptIssuer";
import {
  addEditorAction,
  deleteSecretAction,
  deleteToolAction,
  hardDeleteToolAction,
  putSecretAction,
  removeEditorAction,
  restoreToolAction,
  rollbackToolAction,
  stopToolAction,
} from "./actions";

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  create: "作成",
  upload: "アップロード",
  stop: "停止",
  restore: "復元",
  rollback: "戻す",
  reconcile: "調整",
};

export default async function ToolPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const user = await getCurrentUser();
  if (!user) return <p className="error">ログインが必要です。</p>;
  const tool = await getTool(name);
  if (!tool || tool.status === "deleted") notFound();

  const editors = await getEditors(tool.id);
  const manage = canManage(tool, user.email);
  const edit = canEdit(tool, editors, user.email);
  const secrets = await listSecrets(tool);
  const releases = await listReleases(tool.id, 20);
  const url = toolUrl(tool.name);

  return (
    <>
      <p className="muted">
        <Link href="/">← 一覧</Link>
      </p>
      <h1>
        {tool.name} <StatusBadge status={tool.status} />
      </h1>
      <div className="card">
        <dl className="meta">
          <dt>URL</dt>
          <dd>
            {tool.status === "live" ? (
              <a href={url} target="_blank" rel="noreferrer">
                {url}
              </a>
            ) : (
              <span className="muted">{url}(停止中)</span>
            )}
          </dd>
          <dt>説明</dt>
          <dd>{tool.description}</dd>
          <dt>作成者</dt>
          <dd>{tool.owner}</dd>
          <dt>作成日</dt>
          <dd>{formatDate(tool.createdAt)}</dd>
          {tool.deleteScheduledAt && (
            <>
              <dt>完全削除の予定</dt>
              <dd>{formatDate(tool.deleteScheduledAt)}</dd>
            </>
          )}
          <dt>テーブルの接頭語</dt>
          <dd>
            <code>{tool.name.replace(/-/g, "_")}_</code>
          </dd>
          <dt>現在のバージョン</dt>
          <dd>{tool.currentReleaseId !== null ? `#${tool.currentReleaseId}` : <span className="muted">未反映</span>}</dd>
        </dl>
      </div>

      {edit && tool.status === "live" && <PromptIssuer name={tool.name} />}

      {manage && (
        <div className="toolbar">
          {tool.status === "live" && (
            <>
              <ActionButton label="停止" confirm="停止すると URL が開けなくなります。データは残ります。よろしいですか?" action={stopToolAction.bind(null, tool.name)} />
              <ActionButton label="前のリリースに戻す" confirm="コードだけが前のリリースに戻ります(マイグレーションは戻りません)。よろしいですか?" action={rollbackToolAction.bind(null, tool.name)} />
              <ActionButton
                label={`削除(${config.OKIBA_DELETE_GRACE_DAYS} 日後に完全削除)`}
                className="danger"
                confirm={`停止して ${config.OKIBA_DELETE_GRACE_DAYS} 日後にテーブルと認証情報を消します。猶予期間中は復元できます。よろしいですか?`}
                action={deleteToolAction.bind(null, tool.name)}
              />
            </>
          )}
          {tool.status === "stopped" && (
            <>
              <ActionButton label="復元" action={restoreToolAction.bind(null, tool.name)} />
              {isAdmin(user.email) && (
                <ActionButton label="今すぐ完全削除" className="danger" confirm="テーブル、認証情報、トークンを今すぐ消します。元に戻せません。よろしいですか?" action={hardDeleteToolAction.bind(null, tool.name)} />
              )}
            </>
          )}
        </div>
      )}

      <h2>Editor</h2>
      <div className="card">
        {editors.length === 0 ? <p className="muted">editor はいません</p> : null}
        <ul>
          {editors.map((e) => (
            <li key={e}>
              {e} {manage && <ActionButton label="外す" action={removeEditorAction.bind(null, tool.name, e)} />}
            </li>
          ))}
        </ul>
        {manage && (
          <FormWithState action={addEditorAction.bind(null, tool.name)} submitLabel="追加">
            <input name="email" type="email" placeholder="someone@example.com" required />
          </FormWithState>
        )}
      </div>

      <h2>認証情報</h2>
      <div className="card">
        <p className="muted">
          ツールが外部サービスを呼ぶときのキー。値は登録後に表示されません。ツールのコードからは <code>getSecret(&quot;KEY&quot;)</code> で取れます。
        </p>
        <table>
          <thead>
            <tr>
              <th>キー</th>
              <th>更新者</th>
              <th>更新日時</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {secrets.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  登録されていません
                </td>
              </tr>
            )}
            {secrets.map((s) => (
              <tr key={s.keyName}>
                <td>
                  <code>{s.keyName}</code>
                </td>
                <td>{s.updatedBy}</td>
                <td>{formatDate(s.updatedAt)}</td>
                <td>{edit && <ActionButton label="削除" className="danger" confirm={`${s.keyName} を削除しますか?`} action={deleteSecretAction.bind(null, tool.name, s.keyName)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && (
          <div style={{ marginTop: 12 }}>
            <FormWithState action={putSecretAction.bind(null, tool.name)} submitLabel="登録 / 更新">
              <input name="key" placeholder="SLACK_TOKEN" pattern="[A-Z][A-Z0-9_]{1,63}" required style={{ maxWidth: 220 }} />
              <input name="value" type="password" placeholder="値" required autoComplete="off" style={{ maxWidth: 320 }} />
            </FormWithState>
          </div>
        )}
      </div>

      <h2>リリース</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>種類</th>
            <th>状態</th>
            <th>実行者</th>
            <th>日時</th>
            <th>ログ</th>
          </tr>
        </thead>
        <tbody>
          {releases.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                まだリリースはありません
              </td>
            </tr>
          )}
          {releases.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{REASON_LABELS[r.reason] ?? r.reason}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>{r.createdBy}</td>
              <td>
                {formatDate(r.createdAt)}
                {r.finishedAt && <div className="muted">完了 {formatDate(r.finishedAt)}</div>}
                {r.appRef && <div className="muted">基盤 {r.appRef}</div>}
              </td>
              <td>
                {r.log && (
                  <details>
                    <summary>表示</summary>
                    <pre className="log">{r.log}</pre>
                  </details>
                )}
                {r.logUrl && (
                  <a href={r.logUrl} target="_blank" rel="noreferrer" className="muted">
                    ビルドログ ↗
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
