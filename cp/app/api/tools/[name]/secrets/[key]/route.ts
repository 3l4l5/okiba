import { z } from "zod";
import { handle, json, readJsonBody } from "@/src/lib/api";
import { canEdit, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { deleteSecret, putSecret } from "@/src/services/secrets";
import { getEditors, requireTool } from "@/src/services/tools";

export const dynamic = "force-dynamic";

const schema = z.object({ value: z.string() });

export const PUT = handle(async (req, { params }) => {
  const user = await requireUser();
  const { name, key } = await params;
  const tool = await requireTool(name);
  if (!canEdit(tool, await getEditors(tool.id), user.email)) throw new ApiError(403, "権限がありません");
  const body = schema.parse(await readJsonBody(req));
  await putSecret(tool, key, body.value, user.email);
  return json({ ok: true, key });
});

export const DELETE = handle(async (_req, { params }) => {
  const user = await requireUser();
  const { name, key } = await params;
  const tool = await requireTool(name);
  if (!canEdit(tool, await getEditors(tool.id), user.email)) throw new ApiError(403, "権限がありません");
  await deleteSecret(tool, key);
  return json({ ok: true });
});
