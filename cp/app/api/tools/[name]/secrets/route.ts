import { handle, json } from "@/src/lib/api";
import { canEdit, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { listSecrets } from "@/src/services/secrets";
import { getEditors, requireTool } from "@/src/services/tools";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req, { params }) => {
  const user = await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  if (!canEdit(tool, await getEditors(tool.id), user.email)) throw new ApiError(403, "権限がありません");
  const rows = await listSecrets(tool);
  return json({ secrets: rows.map((r) => ({ key: r.keyName, updatedBy: r.updatedBy, updatedAt: r.updatedAt })) });
});
