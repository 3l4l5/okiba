"use client";

import { useState, useTransition } from "react";
import type { ActionState } from "./actions";

interface Props {
  label: string;
  confirm?: string;
  className?: string;
  action: () => Promise<ActionState>;
}

/** 確認してからサーバーアクションを呼ぶボタン */
export function ActionButton({ label, confirm, className, action }: Props) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>({});
  return (
    <span>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setState(await action()));
        }}
      >
        {pending ? "処理中..." : label}
      </button>
      {state.error && <span className="error"> {state.error}</span>}
      {state.message && <span className="muted"> {state.message}</span>}
    </span>
  );
}
