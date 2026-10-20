# CP、ツールアプリ、ワーカーの 3 つの Lambda。どれもコンテナイメージ + Lambda Web Adapter。
# 最初のイメージ(タグ bootstrap)は手で push する。以後ツールアプリのイメージは CP が更新するので
# Terraform は image_uri の変更を追わない。

# ---- ECR ----

resource "aws_ecr_repository" "app" {
  name                 = "${var.project}-app"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "cp" {
  name                 = "${var.project}-cp"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "直近 20 イメージだけ残す"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "cp" {
  repository = aws_ecr_repository.cp.name
  policy     = local.ecr_lifecycle_policy
}

# ---- セキュリティグループ ----

resource "aws_security_group" "lambda" {
  name        = "${var.project}-lambda"
  description = "okiba Lambda (CP, app, worker)"
  vpc_id      = var.vpc_id

  # Lambda は ALB から直接は呼ばれない(Invoke API 経由)ので ingress は不要(SC-2)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---- ログ ----

resource "aws_cloudwatch_log_group" "app" {
  name              = local.app_log_group
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "cp" {
  name              = local.cp_log_group
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/lambda/${var.project}-worker"
  retention_in_days = 30
}

# ---- GitHub App の秘密鍵(Terraform の外で SSM に置く) ----
# 環境変数は合計 4KB までなので、鍵が大きい場合は CP 側で SSM から読む方式
# (GITHUB_APP_PRIVATE_KEY_SSM_NAME)に切り替える。
data "aws_ssm_parameter" "github_app_private_key" {
  name            = var.github_app_private_key_ssm_name
  with_decryption = true
}

# ---- 共通の環境変数 ----

locals {
  cp_environment = {
    OKIBA_MODE               = "aws"
    OKIBA_AUTH_MODE          = "alb"
    OKIBA_ALLOWED_DOMAIN     = var.allowed_domain
    OKIBA_ADMINS             = join(",", var.admins)
    OKIBA_CP_URL             = local.cp_url
    OKIBA_TOOLS_URL          = local.tools_url
    PLATFORM_DATABASE_URL    = local.platform_database_url
    TOOLS_DATABASE_URL       = local.tools_database_url
    OKIBA_SSM_PREFIX         = local.ssm_prefix
    OKIBA_S3_BUCKET          = aws_s3_bucket.main.bucket
    OKIBA_CODEBUILD_PROJECT  = aws_codebuild_project.app.name
    OKIBA_ECR_REPO_URI       = aws_ecr_repository.app.repository_url
    OKIBA_APP_LAMBDA_FUNCTION = "${var.project}-app"
    OKIBA_APP_LOG_GROUP      = local.app_log_group
    GITHUB_APP_ID            = var.github_app_id
    GITHUB_INSTALLATION_ID   = var.github_installation_id
    GITHUB_REPO              = var.github_repo
    GITHUB_MAIN_BRANCH       = "main"
    GITHUB_APP_PRIVATE_KEY   = data.aws_ssm_parameter.github_app_private_key.value
    GITHUB_APP_PRIVATE_KEY_SSM_NAME = var.github_app_private_key_ssm_name
    # Lambda Web Adapter
    AWS_LWA_PORT             = "3000"
    PORT                     = "3000"
  }
}

# ---- CP ----

resource "aws_lambda_function" "cp" {
  function_name = "${var.project}-cp"
  role          = aws_iam_role.cp.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.cp.repository_url}:${var.bootstrap_image_tag}"
  memory_size   = 1024
  timeout       = 30

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = local.cp_environment
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [aws_cloudwatch_log_group.cp]
}

# ---- ツールアプリ ----

resource "aws_lambda_function" "app" {
  function_name = "${var.project}-app"
  role          = aws_iam_role.app.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.app.repository_url}:${var.bootstrap_image_tag}"
  memory_size   = 1024
  timeout       = 30

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      OKIBA_MODE           = "aws"
      OKIBA_AUTH_MODE      = "alb"
      OKIBA_ALLOWED_DOMAIN = var.allowed_domain
      OKIBA_CP_URL         = local.cp_url
      OKIBA_TOOLS_URL      = local.tools_url
      DATABASE_URL         = local.app_database_url
      OKIBA_SSM_PREFIX     = local.ssm_prefix
      AWS_LWA_PORT         = "3001"
      PORT                 = "3001"
    }
  }

  # CP が lambda:UpdateFunctionCode でイメージを差し替える(8.2)
  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [aws_cloudwatch_log_group.app]
}

# ---- ワーカー(リリースの状態機械、調整ループ、予約削除) ----
#
# CP と同じイメージを使う。Lambda Web Adapter は HTTP 以外のイベント(EventBridge)を
# AWS_LWA_PASS_THROUGH_PATH のパスに POST で渡すので、CP 側は POST /api/internal/tick で
# 1 回分の処理(tick)を実行する。このパスは ALB の優先度 10 のルールで外からは 404 にしている。
#
# 代わりに tsx のスクリプトをコマンドとして動かす案もあるが、Lambda Web Adapter の下では
# HTTP サーバーが起動しないと Lambda が完了しないため、この方式にしている。

resource "aws_lambda_function" "worker" {
  function_name = "${var.project}-worker"
  role          = aws_iam_role.cp.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.cp.repository_url}:${var.bootstrap_image_tag}"
  memory_size   = 1024
  timeout       = 300

  # 同時に 2 つの tick を動かさない(リリースは直列)
  reserved_concurrent_executions = 1

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = merge(local.cp_environment, {
      AWS_LWA_PASS_THROUGH_PATH = "/api/internal/tick"
      OKIBA_ROLE                = "worker"
    })
  }

  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [aws_cloudwatch_log_group.worker]
}

resource "aws_cloudwatch_event_rule" "worker" {
  name                = "${var.project}-worker-tick"
  description         = "okiba worker を 1 分ごとに起動する"
  schedule_expression = "rate(1 minute)"
}

resource "aws_cloudwatch_event_target" "worker" {
  rule      = aws_cloudwatch_event_rule.worker.name
  target_id = "worker"
  arn       = aws_lambda_function.worker.arn
}

resource "aws_lambda_permission" "events_worker" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.worker.arn
}
