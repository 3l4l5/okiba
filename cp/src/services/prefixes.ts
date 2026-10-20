import { toTablePrefix } from "@okiba/shared";
import { ne } from "drizzle-orm";
import { platformDb } from "../db/platform";
import { tools } from "../db/schema";

/** 自分以外の、削除されていないツールの接頭語 */
export async function otherPrefixes(toolName: string): Promise<string[]> {
  const rows = await platformDb().select({ name: tools.name }).from(tools).where(ne(tools.status, "deleted"));
  return rows.filter((r) => r.name !== toolName).map((r) => toTablePrefix(r.name));
}
