# ツール __TOOL_NAME__

`/tools/__TOOL_NAME__` で開ける業務ツールです。このディレクトリの中だけを編集します。

## ファイル

| ファイル | 役割 |
|---|---|
| `page.tsx` | 画面。Server Component なので、直接 DB を読めます |
| `actions.ts` | Server Actions。フォームからの追加・削除など、DB の書き換え |
| `schema.ts` | Drizzle のテーブル定義 |
| `migrations/NNNN_xxx.sql` | テーブルの作成・変更。連番で増やします。リリース時に基盤が順番に流します |

画面を増やすときは、サブディレクトリに `page.tsx` を置くと `/tools/__TOOL_NAME__/<サブディレクトリ>` になります。

## 守ること

- 書いてよいのは `app/tools/__TOOL_NAME__/` の中だけ。`package.json`、`lib/`、`middleware.ts` などの基盤ファイルは変更できません(アップロード時に拒否されます)
- テーブル名は必ず `__PREFIX__` で始める(例: `__PREFIX__memos`)。他のツールのテーブルは読み書きしない
- `migrations/` の SQL は、自分の接頭語のテーブルにしか触れないこと。`CREATE TABLE` / `ALTER TABLE` / `DROP TABLE` / `CREATE INDEX` / `INSERT` などが使えます
- npm パッケージは追加できません。使えるのは基盤に入っているもの(React、Next.js、Drizzle、zod など)だけ
- API キーなどの認証情報はコードに書かない。管理画面で登録して、`getSecret("KEY")`(`@/lib/secrets`)で取る
- 利用者は `getCurrentUser()`(`@/lib/user`)で取る。独自のログイン画面は作らない
- ログは `log()` / `logError()`(`@/lib/log`)で出す。管理画面の logs でツールごとに見られます
- 状態は DB にだけ持つ。ローカルファイルは消えます
