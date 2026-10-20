// ツールのテーブルを置く database。マイグレーションの適用、ダンプ、削除に使う。
import mysql, { type Pool } from "mysql2/promise";
import { config } from "../config";

const globalRef = globalThis as unknown as { __okibaToolsDb?: Pool };

export function toolsDb(): Pool {
  if (!globalRef.__okibaToolsDb) {
    globalRef.__okibaToolsDb = mysql.createPool({ uri: config.TOOLS_DATABASE_URL, connectionLimit: 3, timezone: "Z" });
  }
  return globalRef.__okibaToolsDb;
}

export function toolsDbName(): string {
  const url = new URL(config.TOOLS_DATABASE_URL);
  return url.pathname.replace(/^\//, "");
}
