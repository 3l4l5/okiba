# infra(Terraform)

okiba を自社の AWS に立てるための Terraform。設計書の 10 章(AWS 構成)、9 章(Security Contract)、7.8(ツールごとの認証情報)に対応する。

> **注意: この Terraform はまだ `terraform validate` / `apply` を通していない。** 手元に Terraform がない状態で書いたもので、リソースの引数名や細かい挙動は初回の `plan` で直す前提。特に RDS Proxy の `auth` ブロック、ALB の `authenticate-oidc` と Lambda ターゲットグループの組み合わせ、Lambda Web Adapter のイベント受け渡しは実機で確認すること。

## 構成

| ファイル | 内容 |
|---|---|
| `alb.tf` | ALB、HTTPS リスナー、Google OIDC のルール、Upload Token API の OIDC 除外、Route53(任意) |
| `lambda.tf` | ECR、Lambda(cp / app / worker)、EventBridge の 1 分スケジュール、ログ |
| `rds.tf` | RDS MySQL 8.0、RDS Proxy、Secrets Manager のパスワード |
| `build.tf` | S3(ソース zip / ダンプ / ビルドログ)、CodeBuild とその最小権限ロール(SC-5) |
| `iam.tf` | CP とツールアプリの実行ロール |
| `secrets.tf` | SSM SecureString 用の KMS キー、`/okiba/platform/` の予約 |
| `sql/bootstrap.sql` | RDS に 1 度だけ流す database とユーザーの作成 |
| `scp-example.json` | 組織(Organizations)で手で適用する SCP の例 |

## 事前に用意するもの

1. **VPC**: プライベートサブネット(Lambda / RDS 用)とパブリックサブネット(ALB 用)をそれぞれ 2 AZ 以上。プライベートサブネットから GitHub / ECR / SSM に出られること(NAT か VPC エンドポイント)。
2. **ACM 証明書**: `okiba.<domain>` と `tools.<domain>` をカバーするもの(ワイルドカードでよい)。
3. **Google OAuth クライアント**(Google Cloud Console):
   - OAuth 同意画面は **Internal**(組織内のアカウントに限定する。ALB の OIDC だけではドメインを制限できない)
   - 承認済みリダイレクト URI に `https://okiba.<domain>/oauth2/idpresponse` と `https://tools.<domain>/oauth2/idpresponse` の両方
   - クライアント ID とシークレットを `google_client_id` / `google_client_secret` に渡す
4. **GitHub App**: Contents の書き込み権限だけを持たせ、okiba のリポジトリにインストールする。秘密鍵(PEM)は SSM に置く:
   ```sh
   aws ssm put-parameter --name /okiba/platform/github-app-private-key \
     --type SecureString --key-id alias/okiba-ssm --value file://private-key.pem
   ```
   (`alias/okiba-ssm` は最初の `apply` で作られるので、鍵の登録は 1 回目の apply のあと。`data.aws_ssm_parameter` が失敗する場合は、`lambda.tf` の該当箇所を一時的にコメントアウトして 2 段階で apply する)
5. **Terraform 実行用ロール** `okiba-terraform`(SCP の例外に使う名前)。

## 手順

```sh
cd infra
cp terraform.tfvars.example terraform.tfvars   # 値を埋める(ファイルは自分で作る)
terraform init
terraform plan
terraform apply
```

1. **apply**: ALB、Lambda(イメージは `bootstrap` タグを指すが、まだ存在しないので Lambda の作成が失敗する場合は先に 2 を行う)、RDS、CodeBuild などが作られる。
2. **最初のイメージを push**(リポジトリのルートで):
   ```sh
   AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   REGION=ap-northeast-1
   aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT.dkr.ecr.$REGION.amazonaws.com
   docker build -f app/Dockerfile -t $AWS_ACCOUNT.dkr.ecr.$REGION.amazonaws.com/okiba-app:bootstrap .
   docker build -f cp/Dockerfile  -t $AWS_ACCOUNT.dkr.ecr.$REGION.amazonaws.com/okiba-cp:bootstrap .
   docker push $AWS_ACCOUNT.dkr.ecr.$REGION.amazonaws.com/okiba-app:bootstrap
   docker push $AWS_ACCOUNT.dkr.ecr.$REGION.amazonaws.com/okiba-cp:bootstrap
   ```
   以後ツールアプリのイメージは CP が更新する(`lifecycle.ignore_changes = [image_uri]`)。
3. **database とユーザーを作る**: 踏み台(または ECS Exec など VPC 内の環境)から RDS のインスタンスエンドポイントに `okiba_admin` で接続し、`sql/bootstrap.sql` を流す。パスワードは Secrets Manager の `okiba/db/okiba_cp` と `okiba/db/okiba_app` の値に置き換える。
4. **台帳のテーブルを作る**: VPC 内から `PLATFORM_DATABASE_URL` を設定して `npm run db:migrate -w cp` を 1 回実行する(RDS Proxy のエンドポイント経由でよい)。
5. **DNS**: `create_route53_records = true` にして Route53 に A レコード(ALB のエイリアス)を作るか、他の DNS に手で CNAME を作る。
6. `https://okiba.<domain>/` を開いて Google のログインが出れば完了。

## ALB の OIDC を通さない API

AI エージェント(Claude Code など)は作成者の手元で動き、ブラウザのセッションを持たない。そのため CP の次の 4 つのパスだけは、ALB の優先度 20 のルールで OIDC を通さずに CP に渡す(SC-1 の例外)。CP 側は Upload Token(Bearer)で認証する。

- `/api/tools/*/files`
- `/api/tools/*/uploads`
- `/api/tools/*/releases/*`
- `/api/tools/*/logs`

`/api/internal/*`(ワーカーの tick)は優先度 10 のルールで外からは 404 にしている。ツールアプリの `/healthz` も OIDC なしで通す。

## ワーカーの動かし方

`okiba-worker` は CP と同じイメージの Lambda で、EventBridge が 1 分ごとに起動する。Lambda Web Adapter は HTTP 以外のイベントを `AWS_LWA_PASS_THROUGH_PATH`(`/api/internal/tick`)に POST で渡すので、**CP 側に `POST /api/internal/tick` を実装し、そこで 1 回分の処理(リリースの状態機械、予約削除、調整ループ、認証情報の棚卸し)を行う**。`reserved_concurrent_executions = 1` で同時実行を防ぐ。

## SCP

`scp-example.json` は Organizations で手で適用する(Terraform では管理しない)。`ACCOUNT_ID` を置き換えること。JSON にはコメントが書けないので内容をここに書く:

- `DenyPublicRds`: RDS をインターネットに公開できない(SC-2)
- `DenyPublicS3`: `okiba-terraform` 以外は S3 の公開設定を変えられない
- `DenyLambdaFunctionUrl`: Lambda の関数 URL を作れない(ALB の OIDC を迂回させない)
- `DenyLoadBalancerCreationExceptTerraform`: `okiba-terraform` 以外はロードバランサとリスナーを作れない(SC-3)

## 費用の目安(東京、概算)

ALB $20〜、RDS t4g.small + RDS Proxy $40〜60、Lambda ほぼ $0〜数ドル、CodeBuild 月 300 ビルドで $5 程度、S3 / ECR / CloudWatch 数ドル。合計 **月 $70〜90** で、ツールが増えてもほとんど増えない。
