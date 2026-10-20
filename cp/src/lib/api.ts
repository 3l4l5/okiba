// API ルートの共通処理。エラーの JSON 化、Upload Token の認証、レート制限。
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./errors";
import { verifyUploadToken, type VerifiedToken } from "./token";

export function json(data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, { status: init?.status ?? 200 });
}

type RouteContext = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: RouteContext) => Promise<Response>;

export function handle(fn: Handler): Handler {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message, details: err.details }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return json({ error: "入力が不正です", details: err.flatten() }, { status: 400 });
      }
      console.error(err);
      return json({ error: "内部エラーが発生しました" }, { status: 500 });
    }
  };
}

const RATE_LIMIT_PER_MINUTE = 60;
const buckets = new Map<string, { windowStart: number; count: number }>();

/** トークンごとに 1 分あたりの回数を数える。プロセス内だけの簡易なもの */
export function checkRateLimit(key: string, limit = RATE_LIMIT_PER_MINUTE): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > 60_000) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) throw new ApiError(429, "リクエストが多すぎます。しばらく待ってください");
  if (buckets.size > 10_000) buckets.clear();
}

export async function requireTokenAuth(req: NextRequest, toolName: string): Promise<VerifiedToken> {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, "Authorization: Bearer <Upload Token> が必要です");
  const verified = await verifyUploadToken(match[1].trim(), toolName);
  if (!verified) throw new ApiError(401, "Upload Token が無効か、期限切れです。管理画面で再発行してください");
  checkRateLimit(verified.token.tokenHash);
  return verified;
}

export async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "JSON の本文が必要です");
  }
}
