# ビルドは CP の外(CodeBuild)で行う。CP が S3 に置いた zip をソースにして
# ツールアプリのイメージをビルドし、ECR に push する(buildspec.yml は zip の中)。

# ---- S3: ソース zip、DB ダンプ、ビルドログ ----

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

  rule {
    id     = "sources"
    status = "Enabled"
    filter {
      prefix = "sources/"
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

# ---- CodeBuild ----

resource "aws_cloudwatch_log_group" "codebuild" {
  name              = "/aws/codebuild/${var.project}-app-build"
  retention_in_days = 30
}

# ビルドが持てる権限はソースの読み取りと ECR への push だけ(SC-5)
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
    sid       = "ReadSources"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["${aws_s3_bucket.main.arn}/sources/*"]
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

  # 実際のソースは CP が StartBuild の sourceLocationOverride で渡す。
  # buildspec は zip のルートの buildspec.yml を使う。
  source {
    type     = "S3"
    location = "${aws_s3_bucket.main.bucket}/sources/placeholder.zip"
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.codebuild.name
    }
  }
}
