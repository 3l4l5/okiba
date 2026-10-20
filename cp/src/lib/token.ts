// Upload Token。生の値は発行時にだけ返し、台帳にはハッシュしか置かない。
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { platformDb } from "../db/platform";
import { tools, uploadTokens, type ToolRow, type UploadTokenRow } from "../db/schema";

export const TOKEN_PREFIX = "okt_";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateToken(): { raw: string; hash: string } {
  const raw = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashToken(raw) };
}

export function looksLikeToken(raw: string): boolean {
  return raw.startsWith(TOKEN_PREFIX) && raw.length >= TOKEN_PREFIX.length + 32;
}

export interface VerifiedToken {
  token: UploadTokenRow;
  tool: ToolRow;
}

/** 生のトークンを検証し、対応するツールを返す。期限切れ・失効・ツール違いは null */
export async function verifyUploadToken(raw: string, toolName: string): Promise<VerifiedToken | null> {
  if (!looksLikeToken(raw)) return null;
  const db = platformDb();
  const rows = await db
    .select({ token: uploadTokens, tool: tools })
    .from(uploadTokens)
    .innerJoin(tools, eq(tools.id, uploadTokens.toolId))
    .where(and(eq(uploadTokens.tokenHash, hashToken(raw)), eq(tools.name, toolName)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.token.revokedAt) return null;
  if (row.token.expiresAt.getTime() < Date.now()) return null;
  return row;
}
