locals {
  account_id = data.aws_caller_identity.current.account_id

  cp_host    = "${var.cp_hostname}.${var.domain}"
  tools_host = "${var.tools_hostname}.${var.domain}"
  cp_url     = "https://${local.cp_host}"
  tools_url  = "https://${local.tools_host}"

  ssm_prefix = "/okiba"

  app_log_group = "/aws/lambda/${var.project}-app"
  cp_log_group  = "/aws/lambda/${var.project}-cp"

  # RDS Proxy 経由の接続文字列。パスワードは Secrets Manager の値
  platform_database_url = "mysql://okiba_cp:${random_password.cp_user.result}@${aws_db_proxy.main.endpoint}:3306/okiba_platform"
  tools_database_url    = "mysql://okiba_cp:${random_password.cp_user.result}@${aws_db_proxy.main.endpoint}:3306/okiba_tools"
  app_database_url      = "mysql://okiba_app:${random_password.app_user.result}@${aws_db_proxy.main.endpoint}:3306/okiba_tools"

  # ALB の OIDC 認証の対象外にするパス(Upload Token で別に認証する API)
  token_api_paths = [
    "/api/tools/*/files",
    "/api/tools/*/uploads",
    "/api/tools/*/releases/*",
    "/api/tools/*/logs",
  ]
}
