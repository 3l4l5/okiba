# ビルドは CP の外(CodeBuild)で行う。
#
# ソースは 2 つ:
#   1. 基盤のコード: GitHub の okiba リポジトリを CodeConnections 経由で読み取り専用に取得する。
#      取る ref は var.okiba_app_ref(既定 main)。CP は GitHub に一切書かない。
#   2. ツールのコード: CP が「live な全ツールの最新 payload」を zip にして S3 の bundles/<id>.zip に置き、
#      StartBuild の secondarySourcesOverride(identifier "tools")で渡す。
#      buildspec.yml がそれを app/app/tools/ に展開してから docker build する。
#
# つまり基盤ファイルを変える経路は「基盤担当の PR → main」だけになる(SC-3 / SC-7 を構造で守る)。

# ---- S3: ツールの bundle、DB ダンプ、ビルドログ ----

resource "aws_s3_bucket" "main" {
  bucket = "${var.project}-${local.account_id}"
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  # ツールの bundle(リリースごと)。正本は CP の DB なので 30 日で消してよい
  rule {
    id     = "bundles"
    status = "Enabled"
    filter {
      prefix = "bundles/"
    }
    expiration {
      days = 30
    }
  }

  # 完全削除時のダンプは 90 日で消す(設計書 8.3)
  rule {
    id     = "dumps"
    status = "Enabled"
    filter {
      prefix = "dumps/"
    }
    expiration {
      days = 90
    }
  }

  rule {
    id     = "build-logs"
    status = "Enabled"
    filter {
      prefix = "build-logs/"
    }
    expiration {
      days = 30
    }
  }
}

# ---- GitHub への接続(読み取り専用) ----
#
# 作成直後は PENDING で、AWS コンソール(Developer Tools > Connections)で 1 度だけ
# GitHub 側の認可を済ませると AVAILABLE になる。それまで CodeBuild はソースを取れない。
# プロバイダ 5.x 後半では aws_codeconnections_connection。古いプロバイダでは
# aws_codestarconnections_connection(引数は同じ)。

resource "aws_codeconnections_connection" "github" {
  name          = "${var.project}-github"
  provider_type = "GitHub"
}

# ---- CodeBuild ----

resource "aws_cloudwatch_log_group" "codebuild" {
  name              = "/aws/codebuild/${var.project}-app-build"
  retention_in_days = 30
}

# ビルドが持てる権限は、リポジトリの読み取り、bundle の読み取り、ECR への push だけ(SC-5)
resource "aws_iam_role" "codebuild" {
  name = "${var.project}-codebuild"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

data "aws_iam_policy_document" "codebuild" {
  statement {
    sid       = "ReadBundles"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.main.arn}/bundles/*"]
  }

  # GitHub からのクローンに使う接続。codestar-connections は旧名(互換のため両方)
  statement {
    sid       = "UseGitHubConnection"
    actions   = ["codeconnections:UseConnection", "codestar-connections:UseConnection"]
    resources = [aws_codeconnections_connection.github.arn]
  }

  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.app.arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.codebuild.arn}:*"]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name   = "build"
  role   = aws_iam_role.codebuild.id
  policy = data.aws_iam_policy_document.codebuild.json
}

resource "aws_codebuild_project" "app" {
  name          = "${var.project}-app-build"
  description   = "okiba ツールアプリのイメージをビルドして ECR に push する"
  service_role  = aws_iam_role.codebuild.arn
  build_timeout = 15 # 分。SC-5 の時間上限

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true # docker build のため

    environment_variable {
      name  = "ECR_REPO_URI"
      value = aws_ecr_repository.app.repository_url
    }

    environment_variable {
      name  = "AWS_DEFAULT_REGION"
      value = var.region
    }
  }

  # 基盤のコード。buildspec はリポジトリの buildspec.yml
  source {
    type            = "GITHUB"
    location        = var.github_repo_url
    git_clone_depth = 1
    buildspec       = "buildspec.yml"
  }

  # 取る ref(ブランチ、タグ、コミット)。基盤の更新は main を進めるか、ここを固定して進める
  source_version = var.okiba_app_ref

  # secondary_sources は定義しない。ツールの bundle は CP が StartBuild ごとに
  # secondarySourcesOverride(type S3, identifier "tools", location bundles/<id>.zip)で渡す。

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild.name
    }
  }
}

# CodeBuild プロジェクトに接続を紐づける。resource 名は aws_codebuild_source_credential
# (プロジェクトの source の auth ブロックは非推奨になったため、こちらを使う)
resource "aws_codebuild_source_credential" "github" {
  auth_type   = "CODECONNECTIONS"
  server_type = "GITHUB"
  token       = aws_codeconnections_connection.github.arn
}
