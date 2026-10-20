const LABELS: Record<string, string> = {
  live: "公開中",
  stopped: "停止中",
  deleted: "削除済み",
  queued: "待機中",
  building: "ビルド中",
  migrating: "マイグレーション中",
  deploying: "デプロイ中",
  succeeded: "成功",
  failed: "失敗",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{LABELS[status] ?? status}</span>;
}
