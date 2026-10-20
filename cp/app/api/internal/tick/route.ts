// ワーカー用。EventBridge → Lambda Web Adapter(AWS_LWA_PASS_THROUGH_PATH=/api/internal/tick)→ ここ。
// OKIBA_ROLE=worker のプロセスでしか応答しない(通常の CP は 404)。ALB も /api/internal/* を止めるが、それには頼らない。
import { NextResponse } from "next/server";
import { tick } from "@/src/worker/tick";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  if (process.env.OKIBA_ROLE !== "worker") {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const summary = await tick();
    console.log(JSON.stringify({ type: "tick", ...summary }));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error(JSON.stringify({ type: "tick-error", error: (err as Error).message }));
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
