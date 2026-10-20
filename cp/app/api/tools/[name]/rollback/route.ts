import { handle, json } from "@/src/lib/api";
import { canManage, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { requireTool, rollbackTool } from "@/src/services/tools";

export const dynamic = "force-dynamic";

export const POST = handle(async (_req, { params }) => {
  const user = await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  if (!canManage(tool, user.email)) throw new ApiError(403, "owner か管理者だけが戻せます");
  await rollbackTool(name, user.email);
  return json({ ok: true });
});
