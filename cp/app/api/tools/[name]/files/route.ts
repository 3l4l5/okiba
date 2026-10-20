import { getAdapters } from "@/src/adapters";
import { handle, json, requireTokenAuth } from "@/src/lib/api";
import { listSecretKeys } from "@/src/services/secrets";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { name } = await params;
  const { tool } = await requireTokenAuth(req, name);
  const snapshot = await getAdapters().source.readTool(tool.name);
  return json({ baseSha: snapshot.baseSha, files: snapshot.files, secretKeys: await listSecretKeys(tool) });
});
