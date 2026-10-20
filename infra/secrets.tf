# ツールごとの認証情報(7.8)は SSM Parameter Store の SecureString に置く。
#   /okiba/tools/<name>/<KEY>   ツールの認証情報。CP が登録・削除、ツールアプリが取得
#   /okiba/platform/...         基盤の認証情報。Terraform の外で作る(M1 では使うものがない。
#                               GitHub への接続は CodeConnections なので鍵を置く必要はない)
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
# 将来、基盤側で秘密情報が必要になったら次のように手で登録し、CP 側で読む:
#   aws ssm put-parameter --name /okiba/platform/<NAME> \
#     --type SecureString --key-id alias/okiba-ssm --value '...'
resource "aws_ssm_parameter" "platform_readme" {
  name  = "${local.ssm_prefix}/platform/README"
  type  = "String"
  value = "okiba 基盤の認証情報の置き場。ツールの認証情報は ${local.ssm_prefix}/tools/<name>/<KEY>"
}
