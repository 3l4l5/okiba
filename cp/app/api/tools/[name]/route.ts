import { handle, json } from "@/src/lib/api";
import { canManage, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { getEditors, requireTool, scheduleDelete, toolUrl } from "@/src/services/tools";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, { params }) => {
  await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  return json({
    name: tool.name,
    description: tool.description,
    owner: tool.owner,
    editors: await getEditors(tool.id),
    status: tool.status,
    url: toolUrl(tool.name),
    createdAt: tool.createdAt,
    deleteScheduledAt: tool.deleteScheduledAt,
  });
});

export const DELETE = handle(async (_req, { params }) => {
  const user = await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  if (!canManage(tool, user.email)) throw new ApiError(403, "owner か管理者だけが削除できます");
  await scheduleDelete(name, user.email);
  return json({ ok: true });
});
