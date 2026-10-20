// 全ツールを今の基盤(OKIBA_APP_REF)で作り直す。基盤を更新したあとに管理者が呼ぶ。
import { handle, json } from "@/src/lib/api";
import { isAdmin, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { enqueueRebuild } from "@/src/services/releases";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  const user = await requireUser();
  if (!isAdmin(user.email)) throw new ApiError(403, "管理者だけが再ビルドできます");
  const releaseId = await enqueueRebuild(user.email);
  return json({ releaseId }, { status: 202 });
});
