// 基盤ファイル。どのルートにも当たらないとき(停止・削除されたツールの URL など)。
export default function NotFound() {
  const cpUrl = process.env.OKIBA_CP_URL ?? "http://localhost:3000";
  return (
    <main>
      <h2>このツールは存在しないか、停止中です</h2>
      <p>
        <a href={cpUrl}>ツールの一覧へ</a>
      </p>
    </main>
  );
}
