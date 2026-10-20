import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { config } from "../config";
import * as schema from "./schema";

export type PlatformDb = MySql2Database<typeof schema>;

const globalRef = globalThis as unknown as { __okibaPlatformDb?: PlatformDb };

/** 台帳の DB。プロセスで 1 つのプールを共有する */
export function platformDb(): PlatformDb {
  if (!globalRef.__okibaPlatformDb) {
    const pool = mysql.createPool({ uri: config.PLATFORM_DATABASE_URL, connectionLimit: 5, timezone: "Z" });
    globalRef.__okibaPlatformDb = drizzle(pool, { schema, mode: "default" });
  }
  return globalRef.__okibaPlatformDb;
}
