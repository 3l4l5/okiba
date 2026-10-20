// 基盤ファイル。すべてのリクエストで利用者を決め、/tools/<name> の下ではツール名と利用者をヘッダーで渡す。
// 認証そのものは ALB(authenticate-oidc)が行う。ここでは ALB が付けた JWT を検証するだけ。
import { NextResponse, type NextRequest } from "next/server";
import { resolveUser, type AuthMode } from "@okiba/shared";

export const TOOL_HEADER = "x-okiba-tool";
export const USER_EMAIL_HEADER = "x-okiba-user-email";
export const USER_NAME_HEADER = "x-okiba-user-name";

const FORWARDED_HEADERS = [TOOL_HEADER, USER_EMAIL_HEADER, USER_NAME_HEADER];

function toolNameFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/tools\/([^/]+)/);
  return match ? match[1] : null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ALB のヘルスチェックは認証なし
  if (pathname === "/healthz") {
    return NextResponse.next();
  }

  const mode = (process.env.OKIBA_AUTH_MODE ?? "dev") as AuthMode;
  let user = null;
  try {
    user = await resolveUser(request.headers, {
      mode,
      region: process.env.AWS_REGION,
      devUser: process.env.OKIBA_DEV_USER ?? "dev@example.com",
      allowedDomain: process.env.OKIBA_ALLOWED_DOMAIN,
    });
  } catch (error) {
    console.log(
      JSON.stringify({
        type: "auth_error",
        message: error instanceof Error ? error.message : String(error),
        path: pathname,
        ts: new Date().toISOString(),
      }),
    );
  }
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const tool = toolNameFromPath(pathname);

  // 外から持ち込まれた値は信用しない
  const headers = new Headers(request.headers);
  for (const name of FORWARDED_HEADERS) headers.delete(name);
  headers.set(USER_EMAIL_HEADER, user.email);
  if (user.name) headers.set(USER_NAME_HEADER, user.name);
  if (tool) headers.set(TOOL_HEADER, tool);

  // 集計(利用者数、アクセス数)はこのログから取る
  console.log(
    JSON.stringify({
      type: "access",
      tool,
      user: user.email,
      method: request.method,
      path: pathname,
      ts: new Date().toISOString(),
    }),
  );

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
