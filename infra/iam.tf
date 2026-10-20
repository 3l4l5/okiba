# Lambda の実行ロール。強い権限は CP(とワーカー)だけが持ち、ツールアプリは
# 自分の DB と /okiba/tools/* の読み取りしか持たない。

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# VPC 内で動かすための ENI 操作
data "aws_iam_policy_document" "vpc_access" {
  statement {
    sid = "VpcAccess"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }
}

# ---- CP(ワーカーも同じロール) ----

resource "aws_iam_role" "cp" {
  name               = "${var.project}-cp"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "cp" {
  source_policy_documents = [data.aws_iam_policy_document.vpc_access.json]

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.project}-*:*"]
  }

  # ツールの認証情報(7.8): 登録・取得・削除・一覧
  statement {
    sid = "ToolSecrets"
    actions = [
      "ssm:PutParameter",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:DeleteParameter",
      "ssm:DeleteParameters",
      "ssm:AddTagsToResource",
    ]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/tools/*"]
  }

  # 棚卸し(台帳にないツールのパスを探す)のためにプレフィックス自体も列挙できるようにする
  statement {
    sid       = "ToolSecretsList"
    actions   = ["ssm:GetParametersByPath", "ssm:DescribeParameters"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/tools"]
  }

  # 基盤の認証情報は読み取りのみ
  statement {
    sid       = "PlatformSecretsRead"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/platform/*"]
  }

  statement {
    sid       = "Kms"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.ssm.arn]
  }

  # ソース zip、ダンプ、ビルドログ
  statement {
    sid       = "Bucket"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.main.arn, "${aws_s3_bucket.main.arn}/*"]
  }

  statement {
    sid       = "CodeBuild"
    actions   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds", "codebuild:StopBuild"]
    resources = [aws_codebuild_project.app.arn]
  }

  # ツールアプリのイメージ更新だけ。CP 自身や他の関数は触れない
  statement {
    sid = "DeployApp"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
    ]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${var.project}-app"]
  }

  # UpdateFunctionCode でイメージを指すために ECR の読み取りが要る
  statement {
    sid       = "EcrRead"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"]
    resources = [aws_ecr_repository.app.arn]
  }

  # ツールの実行時ログ(GET /api/tools/{name}/logs)とビルドログの取得
  statement {
    sid     = "ReadLogs"
    actions = ["logs:FilterLogEvents", "logs:GetLogEvents", "logs:DescribeLogStreams"]
    resources = [
      "${aws_cloudwatch_log_group.app.arn}:*",
      "${aws_cloudwatch_log_group.codebuild.arn}:*",
    ]
  }
}

resource "aws_iam_role_policy" "cp" {
  name   = "cp"
  role   = aws_iam_role.cp.id
  policy = data.aws_iam_policy_document.cp.json
}

# ---- ツールアプリ ----

resource "aws_iam_role" "app" {
  name               = "${var.project}-app"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "app" {
  source_policy_documents = [data.aws_iam_policy_document.vpc_access.json]

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.app.arn}:*"]
  }

  # ツールの認証情報の取得だけ。登録・削除はできない(SC-9)
  statement {
    sid       = "ToolSecretsRead"
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_prefix}/tools/*"]
  }

  statement {
    sid       = "KmsDecrypt"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.ssm.arn]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}
