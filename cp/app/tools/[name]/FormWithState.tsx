"use client";

import { useActionState } from "react";
import type { ActionState } from "./actions";

interface Props {
  action: (formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submitLabel: string;
}

/** 入力付きのサーバーアクション用フォーム。結果を横に出す */
export function FormWithState({ action, children, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (_prev, fd) => action(fd), {});
  return (
    <form action={formAction} className="inline">
      {children}
      <button type="submit" disabled={pending}>
        {pending ? "処理中..." : submitLabel}
      </button>
      {state.error && <span className="error">{state.error}</span>}
      {state.message && <span className="muted">{state.message}</span>}
    </form>
  );
}
