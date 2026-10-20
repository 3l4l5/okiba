variable "project" {
  description = "リソース名の接頭語"
  type        = string
  default     = "okiba"
}

variable "region" {
  type    = string
  default = "ap-northeast-1"
}

# ---- ネットワーク(既存の VPC を使う) ----

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  description = "Lambda と RDS を置くプライベートサブネット(2 AZ 以上)"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "ALB を置くパブリックサブネット(2 AZ 以上)"
  type        = list(string)
}

# ---- ドメインと証明書 ----

variable "domain" {
  description = "例: example.co.jp。CP は <cp_hostname>.<domain>、ツールアプリは <tools_hostname>.<domain>"
  type        = string
}

variable "cp_hostname" {
  type    = string
  default = "okiba"
}

variable "tools_hostname" {
  type    = string
  default = "tools"
}

variable "acm_certificate_arn" {
  description = "ALB に付ける ACM 証明書(両ホスト名をカバーするもの)"
  type        = string
}

variable "create_route53_records" {
  type    = bool
  default = false
}

variable "hosted_zone_id" {
  type    = string
  default = ""
}

# ---- SSO(Google) ----

variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}

variable "allowed_domain" {
  description = "Google Workspace のドメイン。これ以外のメールアドレスはアプリ側で拒否する"
  type        = string
}

variable "admins" {
  description = "管理者のメールアドレス"
  type        = list(string)
  default     = []
}

# ---- DB ----

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

# ---- GitHub(読み取り専用。CodeBuild が基盤のコードを取るためだけ) ----

variable "github_repo_url" {
  description = "基盤(okiba)のリポジトリの HTTPS URL。例: https://github.com/3l4l5/okiba.git。プライベートでよい(CodeConnections 経由)"
  type        = string
}

variable "okiba_app_ref" {
  description = "CodeBuild が取る基盤のコードの ref(ブランチ、タグ、コミット)。main のままなら基盤の更新は main のマージで反映される"
  type        = string
  default     = "main"
}

# ---- コンテナイメージ ----

variable "bootstrap_image_tag" {
  description = "最初に手で push するイメージのタグ。以後 CP が更新するので Terraform は追わない"
  type        = string
  default     = "bootstrap"
}
