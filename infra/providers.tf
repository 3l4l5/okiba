provider "aws" {
  region = var.region

  default_tags {
    tags = {
      okiba   = "true"
      project = var.project
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
