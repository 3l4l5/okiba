// このツールのテーブル定義。テーブル名は必ず __PREFIX__ で始める。
import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const memos = mysqlTable("__PREFIX__memos", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
