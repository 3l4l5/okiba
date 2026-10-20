import { handle, json, requireTokenAuth } from "@/src/lib/api";
import { tailToolLogs } from "@/src/services/logs";

export const dynamic = "force-dynamic";

export const GET = handle(async (req, { params }) => {
  const { name } = await params;
  const { tool } = await requireTokenAuth(req, name);
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "200") || 200;
  return json({ lines: await tailToolLogs(tool, limit) });
});
