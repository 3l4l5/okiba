// 基盤ファイル。ツールが使う DB 接続。すべてのツールで 1 つの database を共有する。
// テーブル名は必ず自分の接頭語(<name>_)で始めること。
//
// 接続は最初のクエリまで作らない。`next build` はページのモジュールを評価するが、
// そのとき(CodeBuild など)には DATABASE_URL が無いため、import 時に失敗してはいけない。
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

function getDb(): MySql2Database {
  if (!globalThis.__okibaDb) globalThis.__okibaDb = createDb();
  return globalThis.__okibaDb;
}

/** 遅延初期化した Drizzle クライアント。`db.select()...` のように普通に使える */
export const db: MySql2Database = new Proxy({} as MySql2Database, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
