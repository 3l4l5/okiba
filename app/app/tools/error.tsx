"use client";

// 基盤ファイル。ツールの描画エラーをそのツールの画面の中に閉じ込める。
export default function ToolError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="okiba-error">
      <h2>このツールでエラーが発生しました</h2>
      <p>{error.message}</p>
      {error.digest && <p style={{ color: "#6b7280", fontSize: 12 }}>digest: {error.digest}</p>}
      <button type="button" onClick={() => reset()}>
        もう一度試す
      </button>
    </div>
  );
}
