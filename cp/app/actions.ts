"use server";

import { revalidatePath } from "next/cache";
import { isAdmin, requireUser } from "@/src/lib/auth";
import { ApiError } from "@/src/lib/errors";
import { enqueueRebuild } from "@/src/services/releases";
import type { ActionState } from "./tools/[name]/actions";

/** 管理者の「再ビルド」。全ツールを今の基盤で作り直すリリースをキューに入れる */
export async function rebuildAction(): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (!isAdmin(user.email)) throw new ApiError(403, "管理者だけが再ビルドできます");
    const id = await enqueueRebuild(user.email);
    revalidatePath("/");
    return { message: `再ビルド #${id} をキューに入れました` };
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}
