// 基盤ファイル。middleware が付けたヘッダーから利用者を取る。
import { headers } from "next/headers";

export interface ToolUser {
  email: string;
  name: string;
}

/** 今のリクエストの利用者。ツールは「誰が操作したか」の記録にこれを使う */
export async function getCurrentUser(): Promise<ToolUser> {
  const h = await headers();
  const email = h.get("x-okiba-user-email");
  if (!email) {
    throw new Error("利用者が分かりません(middleware を通っていないリクエストです)");
  }
  return { email, name: h.get("x-okiba-user-name") ?? email.split("@")[0] };
}
