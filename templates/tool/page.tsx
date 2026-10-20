// /tools/__TOOL_NAME__ の画面。Server Component なので、ここで直接 DB を読める。
import { desc, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/user";
import { createMemo, deleteMemo } from "./actions";
import { memos } from "./schema";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const user = await getCurrentUser();

  const rows = await db
    .select()
    .from(memos)
    .where(q ? or(like(memos.title, `%${q}%`), like(memos.body, `%${q}%`)) : undefined)
    .orderBy(desc(memos.createdAt))
    .limit(100);

  return (
    <div>
      <h1>メモ</h1>
      <p style={{ color: "#6b7280" }}>{user.name} さんとしてログイン中</p>

      <section style={{ marginBottom: 24 }}>
        <h2>新しいメモ</h2>
        <form action={createMemo} style={{ display: "grid", gap: 8 }}>
          <input type="text" name="title" placeholder="タイトル" required maxLength={200} />
          <textarea name="body" placeholder="本文(任意)" rows={3} />
          <div>
            <button type="submit">追加</button>
          </div>
        </form>
      </section>

      <section>
        <h2>一覧</h2>
        <form method="get" style={{ marginBottom: 12 }}>
          <input type="search" name="q" defaultValue={q} placeholder="タイトルか本文で検索" />
        </form>
        {rows.length === 0 ? (
          <p>メモはまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>本文</th>
                <th>作成者</th>
                <th>作成日時</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((memo) => (
                <tr key={memo.id}>
                  <td>{memo.title}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{memo.body}</td>
                  <td>{memo.createdBy}</td>
                  <td>{memo.createdAt.toLocaleString("ja-JP")}</td>
                  <td>
                    <form action={deleteMemo.bind(null, memo.id)}>
                      <button type="submit" style={{ background: "#f3f4f6", color: "#1f2937", borderColor: "#e5e7eb" }}>
                        削除
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
