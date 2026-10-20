// 画面と SSO 用 API の利用者。ALB の OIDC ヘッダー(alb)か、開発用ヘッダー(dev)から決める。
import { resolveUser, type CurrentUser } from "@okiba/shared";
import { headers } from "next/headers";
import { config } from "../config";
import type { ToolRow } from "../db/schema";
import { ApiError } from "./errors";

export type { CurrentUser };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return resolveUser(await headers(), {
    mode: config.OKIBA_AUTH_MODE,
    region: config.AWS_REGION,
    devUser: config.OKIBA_DEV_USER,
    allowedDomain: config.OKIBA_ALLOWED_DOMAIN,
  });
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "ログインが必要です");
  return user;
}

export function isAdmin(email: string): boolean {
  return config.admins.includes(email.toLowerCase());
}

/** owner、editor、管理者はツールを編集できる */
export function canEdit(tool: Pick<ToolRow, "owner">, editors: string[], email: string): boolean {
  const e = email.toLowerCase();
  return tool.owner.toLowerCase() === e || editors.some((x) => x.toLowerCase() === e) || isAdmin(email);
}

/** owner と管理者だけが停止・復元・削除・戻すをできる */
export function canManage(tool: Pick<ToolRow, "owner">, email: string): boolean {
  return tool.owner.toLowerCase() === email.toLowerCase() || isAdmin(email);
}
