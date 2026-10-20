// platform database の台帳。src/db/migrations/*.sql を全部当てた形と同じに保つこと。
import {
  char,
  date,
  int,
  longtext,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const TOOL_STATUSES = ["live", "stopped", "deleted"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const RELEASE_OPS = ["replace", "remove", "reconcile"] as const;
export type ReleaseOp = (typeof RELEASE_OPS)[number];

export const RELEASE_STATUSES = ["queued", "building", "migrating", "deploying", "succeeded", "failed"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const RELEASE_REASONS = ["create", "upload", "stop", "restore", "rollback", "reconcile"] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

export const tools = mysqlTable("tools", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 32 }).notNull().unique(),
  description: text("description").notNull(),
  owner: varchar("owner", { length: 255 }).notNull(),
  status: mysqlEnum("status", TOOL_STATUSES).notNull().default("live"),
  /** いま反映されているリリース。ツールのコードの正本はこのリリースの payload */
  currentReleaseId: int("current_release_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  deleteScheduledAt: timestamp("delete_scheduled_at"),
  deletedAt: timestamp("deleted_at"),
});

export const toolEditors = mysqlTable(
  "tool_editors",
  {
    id: int("id").autoincrement().primaryKey(),
    toolId: int("tool_id").notNull(),
    email: varchar("email", { length: 255 }).notNull(),
  },
  (t) => [uniqueIndex("uq_tool_editors").on(t.toolId, t.email)],
);

export const releases = mysqlTable("releases", {
  id: int("id").autoincrement().primaryKey(),
  toolId: int("tool_id"),
  op: mysqlEnum("op", RELEASE_OPS).notNull(),
  reason: varchar("reason", { length: 32 }).notNull(),
  status: mysqlEnum("status", RELEASE_STATUSES).notNull().default("queued"),
  /** アップロードが元にしたバージョン(= 当時の current_release_id。無ければ "0") */
  baseVersion: varchar("base_version", { length: 64 }),
  buildId: varchar("build_id", { length: 255 }),
  /** ビルドに渡した全ツールの zip の置き場所 */
  bundleKey: varchar("bundle_key", { length: 512 }),
  /** 基盤のコードの git ref(イメージをどの基盤で作ったか) */
  appRef: varchar("app_ref", { length: 128 }),
  imageUri: varchar("image_uri", { length: 512 }),
  payload: longtext("payload"),
  log: mediumtext("log"),
  logUrl: varchar("log_url", { length: 1024 }),
  dumpUrl: varchar("dump_url", { length: 1024 }),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export const migrations = mysqlTable(
  "migrations",
  {
    id: int("id").autoincrement().primaryKey(),
    toolId: int("tool_id").notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    // 内容の sha256。0003 より前に適用した行は NULL(チェックしない)
    checksum: char("checksum", { length: 64 }),
    appliedAt: timestamp("applied_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_migrations").on(t.toolId, t.filename)],
);

export const uploadTokens = mysqlTable("upload_tokens", {
  id: int("id").autoincrement().primaryKey(),
  toolId: int("tool_id").notNull(),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  createdBy: varchar("created_by", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const toolSecrets = mysqlTable(
  "tool_secrets",
  {
    id: int("id").autoincrement().primaryKey(),
    toolId: int("tool_id").notNull(),
    keyName: varchar("key_name", { length: 64 }).notNull(),
    updatedBy: varchar("updated_by", { length: 255 }).notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_tool_secrets").on(t.toolId, t.keyName)],
);

export const toolStatsDaily = mysqlTable(
  "tool_stats_daily",
  {
    toolId: int("tool_id").notNull(),
    date: date("date").notNull(),
    requests: int("requests").notNull().default(0),
    errors: int("errors").notNull().default(0),
    uniqueUsers: int("unique_users").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.toolId, t.date] })],
);

export const platformMigrations = mysqlTable("platform_migrations", {
  filename: varchar("filename", { length: 255 }).primaryKey(),
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
});

export type ToolRow = typeof tools.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type UploadTokenRow = typeof uploadTokens.$inferSelect;
export type ToolSecretRow = typeof toolSecrets.$inferSelect;
