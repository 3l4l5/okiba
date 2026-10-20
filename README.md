# okiba

エンジニアではないメンバーが AI(Claude Code など)で業務ツールを作り、組織の SSO の内側にセルフサービスで公開するための社内基盤。

設計書: Notion「appyard Design Doc」(`appyard` は仮称。リポジトリ名は okiba)

## 構成

```
okiba/
├── cp/          # コントロールプレーン(Next.js)。台帳、画面、API、ワーカー
├── app/         # ツールアプリ(Next.js)。app/app/tools/<name>/ が /tools/<name> になる
├── shared/      # 共通の検証(ツール名、アップロード、マイグレーション SQL)と ALB OIDC
├── templates/   # 新規ツールのひな形
├── infra/       # Terraform(AWS)。未検証
└── buildspec.yml  # CodeBuild
```

- ツールのコードは `app/app/tools/<name>/` だけ。それ以外は基盤ファイルで、AI は触れない(CP の検証で拒否)
- テーブル名は `<name>_`(ハイフンはアンダースコア)で始める。CP がマイグレーション SQL を検証する
- ツールの認証情報は Parameter Store `/okiba/tools/<name>/<KEY>` に置き、ツールと一緒に消す

## ソースコードの扱い

ツールのコードは **Git には入れない**。正本は CP の台帳(`releases.payload` と `tools.current_release_id`)で、Git にあるのは基盤のコードだけ(`app/app/tools/` には layout / error / not-found しかない)。

- AI は `files` で現在のコードと `baseVersion` を取り、ディレクトリ丸ごとを `uploads` に送る
- CP は検証して `queued` のリリースを作る。ワーカーが拾い、live な全ツールのコードを zip(バンドル)にして S3 に置き、CodeBuild を起動する
- CodeBuild は GitHub の基盤コード(読み取り専用、固定 ref)の上にバンドルを重ねてイメージを作る。成功したら `current_release_id` が進み、マイグレーション → Lambda 更新
- CP は GitHub に書き込まない。基盤ファイルを変える経路は基盤担当の PR だけ
- 基盤を更新したら、管理画面の「再ビルド」か 5 分ごとの調整ループが全ツールを再ビルドする

## ローカルで動かす

```bash
mise install            # node 24
npm install
docker compose up -d --wait   # MySQL (3310)。初回はボリュームの初期化に数十秒かかる
npm run db:migrate            # platform の台帳テーブル(MySQL の起動を最大 60 秒待つ)

npm run dev:cp          # http://localhost:3000  管理画面
npm run dev:app         # http://localhost:3001  ツールアプリ
npm run worker          # リリースを処理するワーカー(5 秒ごと)
```

ローカルモード(`OKIBA_MODE=local`、既定)では GitHub / CodeBuild / Lambda を使わず、CP がツールのファイルを `app/app/tools/<name>/` に直接書き、Next.js の dev サーバーが拾う。認証は dev モード(`x-okiba-dev-user` ヘッダーか `OKIBA_DEV_USER`)。

流れ:

1. 管理画面で「新しいツール」を作る → ひな形がコミット(ローカルではコピー)され、`/tools/<name>` が開く
2. 「編集用プロンプトを発行」→ プロンプトを AI に貼る
3. AI が `files` を取得 → 修正 → `uploads` に送る → `releases/{id}` で結果を確認

## 検証

```bash
npm run typecheck
npm test
npm run build
```

## AWS

`infra/README.md` を参照。ALB(OIDC)+ Lambda(Web Adapter)+ RDS MySQL + CodeBuild + S3 + SSM Parameter Store。
