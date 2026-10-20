// 基盤ファイル。ツールが使う DB 接続。すべてのツールで 1 つの database を共有する。
// テーブル名は必ず自分の接頭語(<name>_)で始めること。
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

declare global {
  // 開発時のホットリロードで接続プールが増えないようにグローバルに持つ
  // eslint-disable-next-line no-var
  var __okibaDb: MySql2Database | undefined;
}

function createDb(): MySql2Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL が設定されていません");
  const pool = mysql.createPool({
    uri: url,
    // Lambda の 1 インスタンスからはほとんど同時接続しない
    connectionLimit: 3,
    timezone: "Z",
  });
  return drizzle(pool);
}

export const db: MySql2Database = globalThis.__okibaDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalThis.__okibaDb = db;
