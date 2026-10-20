import { handle, json } from "@/src/lib/api";
import { canEdit, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { issuePrompt } from "@/src/services/prompts";
import { getEditors, requireTool } from "@/src/services/tools";

export const dynamic = "force-dynamic";

export const POST = handle(async (_req, { params }) => {
  const user = await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  if (tool.status !== "live") throw new ApiError(400, "公開中のツールにだけ発行できます");
  if (!canEdit(tool, await getEditors(tool.id), user.email)) throw new ApiError(403, "owner、editor、管理者だけが発行できます");
  const issued = await issuePrompt(tool, user.email);
  return json(issued);
});
