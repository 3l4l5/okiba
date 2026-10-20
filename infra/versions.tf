terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # 状態ファイルの置き場は運用に合わせて決める(例: S3 + DynamoDB ロック)
  # backend "s3" {}
}
