"use client";

import { useActionState } from "react";
import { createToolAction, type CreateState } from "./actions";

export function NewToolForm() {
  const [state, action, pending] = useActionState<CreateState, FormData>(createToolAction, {});
  return (
    <form action={action}>
      <label htmlFor="name">名前(英小文字・数字・ハイフン、3〜32 文字。URL とテーブル名の接頭語になります)</label>
      <input id="name" name="name" required pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]" placeholder="visit-memo" />
      <label htmlFor="description">説明(何のためのツールか)</label>
      <textarea id="description" name="description" required rows={3} placeholder="顧客訪問メモの記録と検索" />
      {state.error && <p className="error">{state.error}</p>}
      <div className="toolbar">
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "作成中..." : "作成"}
        </button>
      </div>
      <p className="muted">作成するとひな形が公開され、AI に貼るプロンプトを発行できるようになります。</p>
    </form>
  );
}
