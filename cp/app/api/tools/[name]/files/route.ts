import { handle, json, requireTokenAuth } from "@/src/lib/api";
import { currentToolFiles } from "@/src/services/releases";
import { listSecretKeys } from "@/src/services/secrets";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { name } = await params;
  const { tool } = await requireTokenAuth(req, name);
  const snapshot = await currentToolFiles(tool);
  return json({ baseVersion: snapshot.baseVersion, files: snapshot.files, secretKeys: await listSecretKeys(tool) });
});
