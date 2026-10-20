"use server";

import { revalidatePath } from "next/cache";
import { canEdit, canManage, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { issuePrompt, type IssuedPrompt } from "@/src/services/prompts";
import { deleteSecret, putSecret } from "@/src/services/secrets";
import {
  addEditor,
  getEditors,
  hardDeleteTool,
  removeEditor,
  requireTool,
  restoreTool,
  rollbackTool,
  scheduleDelete,
  stopTool,
} from "@/src/services/tools";

export interface ActionState {
  error?: string;
  message?: string;
}

async function run(name: string, fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    revalidatePath(`/tools/${name}`);
    return message ? { message } : {};
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

async function requireManage(name: string) {
  const user = await requireUser();
  const tool = await requireTool(name);
  if (!canManage(tool, user.email)) throw new ApiError(403, "owner か管理者だけが操作できます");
  return { user, tool };
}

async function requireEdit(name: string) {
  const user = await requireUser();
  const tool = await requireTool(name);
  if (!canEdit(tool, await getEditors(tool.id), user.email)) throw new ApiError(403, "owner、editor、管理者だけが操作できます");
  return { user, tool };
}

export type PromptState = { prompt?: IssuedPrompt; error?: string };

export async function issuePromptAction(name: string): Promise<PromptState> {
  try {
    const { user, tool } = await requireEdit(name);
    if (tool.status !== "live") throw new ApiError(400, "公開中のツールにだけ発行できます");
    return { prompt: await issuePrompt(tool, user.email) };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}

export async function stopToolAction(name: string): Promise<ActionState> {
  return run(name, async () => {
    const { user } = await requireManage(name);
    await stopTool(name, user.email);
    return "停止をキューに入れました";
  });
}

export async function restoreToolAction(name: string): Promise<ActionState> {
  return run(name, async () => {
    const { user } = await requireManage(name);
    await restoreTool(name, user.email);
    return "復元をキューに入れました";
  });
}

export async function rollbackToolAction(name: string): Promise<ActionState> {
  return run(name, async () => {
    const { user } = await requireManage(name);
    await rollbackTool(name, user.email);
    return "前のリリースに戻す処理をキューに入れました";
  });
}

export async function deleteToolAction(name: string): Promise<ActionState> {
  return run(name, async () => {
    const { user } = await requireManage(name);
    await scheduleDelete(name, user.email);
    return "停止しました。猶予期間のあとに完全削除されます";
  });
}

export async function hardDeleteToolAction(name: string): Promise<ActionState> {
  return run(name, async () => {
    await requireManage(name);
    await hardDeleteTool(name);
    return "完全削除しました";
  });
}

export async function addEditorAction(name: string, formData: FormData): Promise<ActionState> {
  return run(name, async () => {
    await requireManage(name);
    await addEditor(name, String(formData.get("email") ?? ""));
  });
}

export async function removeEditorAction(name: string, email: string): Promise<ActionState> {
  return run(name, async () => {
    await requireManage(name);
    await removeEditor(name, email);
  });
}

export async function putSecretAction(name: string, formData: FormData): Promise<ActionState> {
  return run(name, async () => {
    const { user, tool } = await requireEdit(name);
    await putSecret(tool, String(formData.get("key") ?? "").trim(), String(formData.get("value") ?? ""), user.email);
    return "認証情報を登録しました";
  });
}

export async function deleteSecretAction(name: string, key: string): Promise<ActionState> {
  return run(name, async () => {
    const { tool } = await requireEdit(name);
    await deleteSecret(tool, key);
  });
}
