import { z } from "zod";
import { handle, json, readJsonBody } from "@/src/lib/api";
import { requireUser } from "@/src/lib/auth";
import { createTool, listTools, toolUrl } from "@/src/services/tools";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireUser();
  const items = await listTools();
  return json({
    tools: items.map((t) => ({
      name: t.name,
      description: t.description,
      owner: t.owner,
      status: t.status,
      url: t.url,
      createdAt: t.createdAt,
      lastRelease: t.lastRelease ? { id: t.lastRelease.id, status: t.lastRelease.status, createdAt: t.lastRelease.createdAt } : null,
    })),
  });
});

const createSchema = z.object({ name: z.string(), description: z.string() });

export const POST = handle(async (req) => {
  const user = await requireUser();
  const body = createSchema.parse(await readJsonBody(req));
  const tool = await createTool({ name: body.name, description: body.description, owner: user.email });
  return json({ name: tool.name, status: tool.status, url: toolUrl(tool.name) }, { status: 201 });
});
