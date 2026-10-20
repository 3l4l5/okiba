import { getAdapters } from "../adapters";
import type { ToolRow } from "../db/schema";

export async function tailToolLogs(tool: ToolRow, limit: number): Promise<string[]> {
  const n = Math.min(Math.max(1, Math.floor(limit)), 1000);
  return getAdapters().logs.tail(tool.name, n);
}
