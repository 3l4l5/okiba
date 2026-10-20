# ツールごとの認証情報(7.8)は SSM Parameter Store の SecureString に置く。
#   /okiba/tools/<name>/<KEY>   ツールの認証情報。CP が登録・削除、ツールアプリが取得
#   /okiba/platform/...         基盤の認証情報(GitHub App の秘密鍵など)。Terraform の外で作る
# 暗号化は専用の KMS キー。

resource "aws_kms_key" "ssm" {
  description             = "okiba: SSM Parameter Store の SecureString 用"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "ssm" {
  name          = "alias/${var.project}-ssm"
  target_key_id = aws_kms_key.ssm.key_id
}

# 基盤の認証情報のパスを「予約」しておくためのプレースホルダー。
# 実際の値(GitHub App の秘密鍵)は次のように手で登録する:
#   aws ssm put-parameter --name /okiba/platform/github-app-private-key \
#     --type SecureString --key-id alias/okiba-ssm --value file://private-key.pem
# (data.aws_ssm_parameter.github_app_private_key は lambda.tf で参照している)
resource "aws_ssm_parameter" "platform_readme" {
  name  = "${local.ssm_prefix}/platform/README"
  type  = "String"
  value = "okiba 基盤の認証情報の置き場。ツールの認証情報は ${local.ssm_prefix}/tools/<name>/<KEY>"
}
