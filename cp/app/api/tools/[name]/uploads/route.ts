import { handle, json, readJsonBody, requireTokenAuth } from "@/src/lib/api";
import { handleUpload } from "@/src/services/uploads";

export const dynamic = "force-dynamic";

export const POST = handle(async (req, { params }) => {
  const { name } = await params;
  const { tool, token } = await requireTokenAuth(req, name);
  const result = await handleUpload(tool, await readJsonBody(req), token.createdBy);
  return json(result, { status: 202 });
});
