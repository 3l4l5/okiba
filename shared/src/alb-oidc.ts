// ALB の authenticate-oidc が付ける x-amzn-oidc-data ヘッダー(JWT)の検証。
// 署名は ALB の公開鍵(リージョンごとのエンドポイント)で確かめる。

import { compactVerify, decodeProtectedHeader, importSPKI } from "jose";

export interface CurrentUser {
  email: string;
  name?: string;
  sub?: string;
}

export type AuthMode = "alb" | "dev";

export const ALB_OIDC_HEADER = "x-amzn-oidc-data";
export const DEV_USER_HEADER = "x-okiba-dev-user";

const keyCache = new Map<string, Promise<CryptoKey>>();

/** ALB の JWT は base64(パディング付き)で来ることがあるので base64url に揃える */
function toBase64Url(part: string): string {
  return part.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchAlbPublicKey(region: string, kid: string): Promise<CryptoKey> {
  const cacheKey = `${region}/${kid}`;
  let cached = keyCache.get(cacheKey);
  if (!cached) {
    cached = fetch(`https://public-keys.auth.elb.${region}.amazonaws.com/${encodeURIComponent(kid)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`ALB の公開鍵を取得できません: ${res.status}`);
        return res.text();
      })
      .then((pem) => importSPKI(pem, "ES256"));
    keyCache.set(cacheKey, cached);
    cached.catch(() => keyCache.delete(cacheKey));
  }
  return cached;
}

export async function verifyAlbOidcData(jwt: string, region: string): Promise<CurrentUser> {
  const normalized = jwt.trim().split(".").map(toBase64Url).join(".");
  const header = decodeProtectedHeader(normalized);
  if (!header.kid) throw new Error("x-amzn-oidc-data に kid がありません");
  const key = await fetchAlbPublicKey(region, header.kid);
  const { payload } = await compactVerify(normalized, key);
  const claims = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
    throw new Error("x-amzn-oidc-data の有効期限が切れています");
  }
  if (typeof claims.email !== "string") throw new Error("x-amzn-oidc-data に email がありません");
  return {
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : undefined,
    sub: typeof claims.sub === "string" ? claims.sub : undefined,
  };
}

export interface ResolveUserOptions {
  mode: AuthMode;
  region?: string;
  /** dev モードでヘッダーがないときに使う利用者 */
  devUser?: string;
  /** 指定があれば、このドメインのメールアドレス以外を拒否する */
  allowedDomain?: string;
}

/**
 * リクエストヘッダーから利用者を決める。
 * alb: x-amzn-oidc-data を検証する。dev: x-okiba-dev-user か devUser をそのまま使う。
 */
export async function resolveUser(headers: Headers, options: ResolveUserOptions): Promise<CurrentUser | null> {
  let user: CurrentUser | null = null;
  if (options.mode === "dev") {
    const raw = headers.get(DEV_USER_HEADER) ?? options.devUser;
    if (raw) user = { email: raw, name: raw.split("@")[0] };
  } else {
    const jwt = headers.get(ALB_OIDC_HEADER);
    if (jwt) {
      if (!options.region) throw new Error("ALB の検証にはリージョンが必要です");
      user = await verifyAlbOidcData(jwt, options.region);
    }
  }
  if (user && options.allowedDomain && !user.email.toLowerCase().endsWith(`@${options.allowedDomain.toLowerCase()}`)) {
    return null;
  }
  return user;
}
