// platform database のマイグレーション。src/db/migrations/*.sql を順番に流し、platform_migrations に記録する。
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { config } from "../src/config";

async function main() {
  const dir = path.join(__dirname, "..", "src", "db", "migrations");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const conn = await mysql.createConnection({ uri: config.PLATFORM_DATABASE_URL, multipleStatements: true });
  try {
    await conn.query(
      "CREATE TABLE IF NOT EXISTS platform_migrations (filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT filename FROM platform_migrations");
    const applied = new Set(rows.map((r) => r.filename as string));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), "utf8");
      await conn.query(sql);
      await conn.query("INSERT INTO platform_migrations (filename) VALUES (?)", [file]);
      console.log(`applied ${file}`);
    }
    console.log(`platform migrations: ${files.length} files, ${files.length - applied.size} newly applied`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
