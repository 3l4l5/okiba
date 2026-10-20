"use client";

import { useState, useTransition } from "react";
import { issuePromptAction, type PromptState } from "./actions";

export function PromptIssuer({ name }: { name: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<PromptState>({});
  return (
    <div className="card">
      <div className="toolbar">
        <button type="button" className="primary" disabled={pending} onClick={() => start(async () => setState(await issuePromptAction(name)))}>
          {pending ? "発行中..." : "編集用プロンプトを発行"}
        </button>
        {state.prompt && (
          <button type="button" onClick={() => navigator.clipboard.writeText(state.prompt!.prompt)}>
            コピー
          </button>
        )}
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {state.prompt && (
        <>
          <p className="muted">
            Upload Token を含みます。AI(Claude Code など)にそのまま貼ってください。有効期限: {new Date(state.prompt.expiresAt).toLocaleString("ja-JP")}。
            この画面を閉じるとトークンは二度と表示されません(必要なら再発行)。
          </p>
          <textarea className="prompt" readOnly value={state.prompt.prompt} />
        </>
      )}
    </div>
  );
}
