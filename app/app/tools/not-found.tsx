// 基盤ファイル。存在しない、または停止中のツール。
export default function ToolNotFound() {
  const cpUrl = process.env.OKIBA_CP_URL ?? "http://localhost:3000";
  return (
    <div>
      <h2>このツールは存在しないか、停止中です</h2>
      <p>
        <a href={cpUrl}>ツールの一覧へ</a>
      </p>
    </div>
  );
}
