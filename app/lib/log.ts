// 基盤ファイル。ツールのログ。ツール名付きの JSON を 1 行出すので、CP の logs API でツールごとに絞れる。
import { headers } from "next/headers";

type Extra = Record<string, unknown>;

async function currentTool(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-okiba-tool");
  } catch {
    // リクエストの外(ビルド時など)で呼ばれた
    return null;
  }
}

async function emit(level: "info" | "error", message: string, extra?: Extra): Promise<void> {
  const line = JSON.stringify({
    type: "tool",
    tool: await currentTool(),
    level,
    message,
    ...extra,
    ts: new Date().toISOString(),
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

export function log(message: string, extra?: Extra): Promise<void> {
  return emit("info", message, extra);
}

export function logError(message: string, extra?: Extra): Promise<void> {
  return emit("error", message, extra);
}
