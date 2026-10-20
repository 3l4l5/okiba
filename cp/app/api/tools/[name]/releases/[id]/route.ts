import { handle, json, requireTokenAuth } from "@/src/lib/api";
import { ApiError } from "@/src/lib/errors";
import { getRelease } from "@/src/services/releases";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { name, id } = await params;
  const { tool } = await requireTokenAuth(req, name);
  const releaseId = Number(id);
  if (!Number.isInteger(releaseId)) throw new ApiError(400, "リリース ID が不正です");
  return json(await getRelease(tool, releaseId));
});
