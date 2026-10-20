// Lambda から直接呼ぶ場合のハンドラ(EventBridge → Lambda)。
// 通常は Lambda Web Adapter 経由で POST /api/internal/tick が呼ばれるので、こちらは予備。
import { tick } from "./tick";

export async function handler(): Promise<unknown> {
  const summary = await tick();
  console.log(JSON.stringify({ type: "tick", ...summary }));
  return summary;
}
