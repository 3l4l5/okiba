"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { createTool } from "@/src/services/tools";

export interface CreateState {
  error?: string;
}

export async function createToolAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const name = String(formData.get("name") ?? "");
  const description = String(formData.get("description") ?? "");
  let created: string;
  try {
    const user = await requireUser();
    const tool = await createTool({ name, description, owner: user.email });
    created = tool.name;
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  redirect(`/tools/${created}`);
}
