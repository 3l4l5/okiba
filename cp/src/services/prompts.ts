// AI に貼るプロンプトと Upload Token の発行。プロンプトには値ではなくキー名だけを載せる。
import { toTablePrefix } from "@okiba/shared";
import { config } from "../config";
import { platformDb } from "../db/platform";
import { uploadTokens, type ToolRow } from "../db/schema";
import { generateToken } from "../lib/token";
import { listSecretKeys } from "./secrets";

export interface PromptInput {
  toolName: string;
  description: string;
  token: string;
  expiresAt: Date;
  secretKeys: string[];
  cpUrl: string;
  toolsUrl: string;
}

/** プロンプト本文(純粋関数) */
export function buildPrompt(input: PromptInput): string {
  const prefix = toTablePrefix(input.toolName);
  const api = `${input.cpUrl.replace(/\/$/, "")}/api/tools/${input.toolName}`;
  const url = `${input.toolsUrl.replace(/\/$/, "")}/tools/${input.toolName}`;
  const keys = input.secretKeys.length > 0 ? input.secretKeys.map((k) => `\`${k}\``).join(", ") : "(まだ登録されていません)";
  const packer = `node -e 'const fs=require("fs"),p=require("path");const root=process.argv[1];const base=process.argv[2];const out=[];(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else out.push({path:p.relative(root,f).split(p.sep).join("/"),content:fs.readFileSync(f).toString("base64"),encoding:"base64"})}})(root);fs.writeFileSync("upload.json",JSON.stringify({baseSha:base,files:out}))' ./${input.toolName} <baseSha>`;

  return `# okiba のツール「${input.toolName}」を実装する

あなたは社内ツール基盤 okiba の上で動く業務ツールを実装します。コードは Next.js(App Router)のアプリの一部として、
ディレクトリ \`app/tools/${input.toolName}/\` に置かれ、URL \`${url}\` で社内の SSO を通った人だけが使えます。

## このツールについて
- 名前: \`${input.toolName}\`
- 用途: ${input.description}
- 公開 URL: ${url}
- テーブル名の接頭語: \`${prefix}\`

## 守ること
1. 書いてよいのは、取得したファイル一式(ツールのディレクトリの中)だけです。\`page.tsx\` は必ず含めてください。
2. 次のファイルはアップロードできません: package.json、lock ファイル、next.config.*、middleware.ts、Dockerfile、.env*、.github/、tsconfig.json。
3. パッケージは追加できません。使えるのは react、next、drizzle-orm(\`@/lib/db\` 経由)、zod、\`@/lib/user\`、\`@/lib/secrets\`、\`@/lib/log\` です。UI は素の CSS で書きます(CSS Modules 可)。
4. テーブル名は必ず \`${prefix}\` で始めます(例: \`${prefix}items\`)。他のツールのテーブルは読み書きしません。
5. スキーマの変更は \`migrations/NNNN_説明.sql\`(連番)に SQL で書きます。既存の migration ファイルは変更せず、新しいファイルを足します。\`drizzle-kit push\` は使いません。破壊的な変更(DROP、型変更)は避け、列の追加で済ませます。
6. ログイン画面や認証の仕組みは作りません。利用者は \`import { getCurrentUser } from "@/lib/user"\` で取れます(email と name)。
7. 認証情報(API キーなど)はコードに書きません。管理画面で登録したものを \`import { getSecret } from "@/lib/secrets"\` で \`await getSecret("KEY")\` として取ります。登録済みのキー: ${keys}
8. ログは \`import { log } from "@/lib/log"\` の \`log.info(...)\` / \`log.error(...)\` を使います。
9. データの読み書きは Server Components と Server Actions(\`actions.ts\`、\`"use server"\`)で行い、API ルートは原則作りません。
10. 開発中は本物の顧客データではなくダミーデータを使います。

## 作業の流れ
Upload Token: \`${input.token}\`(有効期限: ${input.expiresAt.toISOString()}。期限が切れたら管理画面で再発行してもらってください)

1. 現在のファイル一式を取得して、ローカルの \`./${input.toolName}/\` に展開します。応答の \`baseSha\` を控えます。
\`\`\`
curl -sS -H "Authorization: Bearer ${input.token}" ${api}/files
\`\`\`
   応答: \`{ "baseSha": "...", "files": [{ "path": "page.tsx", "content": "<base64>", "encoding": "base64" }], "secretKeys": [] }\`

2. ファイルを編集します。

3. 一式を upload.json にまとめます(baseSha は 1 で控えたもの):
\`\`\`
${packer}
\`\`\`

4. アップロードします。応答の \`releaseId\` を控えます。
\`\`\`
curl -sS -X POST -H "Authorization: Bearer ${input.token}" -H "Content-Type: application/json" --data @upload.json ${api}/uploads
\`\`\`
   409 が返ったら、他の人が先に更新しています。1 からやり直してください。400 の \`error\` は検証エラーです。直して再送します。

5. リリースの状態を 10 秒ごとに確認し、\`status\` が \`succeeded\` か \`failed\` になるまで待ちます(通常 1〜5 分)。
\`\`\`
curl -sS -H "Authorization: Bearer ${input.token}" ${api}/releases/<releaseId>
\`\`\`
   \`failed\` なら \`log\` を読んで原因を直し、1 からやり直します。

6. 動作がおかしいときは実行時のログを見ます。
\`\`\`
curl -sS -H "Authorization: Bearer ${input.token}" "${api}/logs?limit=200"
\`\`\`

7. 成功したら、利用者に ${url} を案内して、何を変えたかを短く説明します。
`;
}

export interface IssuedPrompt {
  prompt: string;
  token: string;
  expiresAt: Date;
}

export async function issuePrompt(tool: ToolRow, by: string): Promise<IssuedPrompt> {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + config.OKIBA_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await platformDb().insert(uploadTokens).values({ toolId: tool.id, tokenHash: hash, createdBy: by, expiresAt });
  const prompt = buildPrompt({
    toolName: tool.name,
    description: tool.description,
    token: raw,
    expiresAt,
    secretKeys: await listSecretKeys(tool),
    cpUrl: config.OKIBA_CP_URL,
    toolsUrl: config.OKIBA_TOOLS_URL,
  });
  return { prompt, token: raw, expiresAt };
}
