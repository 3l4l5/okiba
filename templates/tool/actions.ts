"use server";

// このツールの Server Actions。画面(page.tsx)のフォームから呼ばれ、DB を書き換える。
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getCurrentUser } from "@/lib/user";
import { memos } from "./schema";

const TOOL_PATH = "/tools/__TOOL_NAME__";

const memoInput = z.object({
  title: z.string().trim().min(1, "タイトルを入れてください").max(200, "タイトルは 200 文字までです"),
  body: z.string().trim().max(10000, "本文は 10000 文字までです").optional(),
});

export async function createMemo(formData: FormData): Promise<void> {
  const parsed = memoInput.safeParse({
    title: formData.get("title"),
    body: formData.get("body") ?? undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join("、"));
  }
  const user = await getCurrentUser();
  await db.insert(memos).values({
    title: parsed.data.title,
    body: parsed.data.body || null,
    createdBy: user.email,
  });
  await log("memo created", { by: user.email });
  revalidatePath(TOOL_PATH);
}

export async function deleteMemo(id: number): Promise<void> {
  const user = await getCurrentUser();
  await db.delete(memos).where(eq(memos.id, id));
  await log("memo deleted", { id, by: user.email });
  revalidatePath(TOOL_PATH);
}
