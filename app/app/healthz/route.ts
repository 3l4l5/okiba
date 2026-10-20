// ALB と Lambda Web Adapter のヘルスチェック。認証なし(middleware で除外)。
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", { status: 200 });
}
