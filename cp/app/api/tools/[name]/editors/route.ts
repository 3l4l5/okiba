import { z } from "zod";
import { handle, json, readJsonBody } from "@/src/lib/api";
import { canManage, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { addEditor, getEditors, removeEditor, requireTool } from "@/src/services/tools";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string() });

export const POST = handle(async (req, { params }) => {
  const user = await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  if (!canManage(tool, user.email)) throw new ApiError(403, "owner か管理者だけが editor を変更できます");
  const body = schema.parse(await readJsonBody(req));
  await addEditor(name, body.email);
  return json({ editors: await getEditors(tool.id) });
});

export const DELETE = handle(async (req, { params }) => {
  const user = await requireUser();
  const { name } = await params;
  const tool = await requireTool(name);
  if (!canManage(tool, user.email)) throw new ApiError(403, "owner か管理者だけが editor を変更できます");
  const body = schema.parse(await readJsonBody(req));
  await removeEditor(name, body.email);
  return json({ editors: await getEditors(tool.id) });
});
