output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "cp_url" {
  value = local.cp_url
}

output "tools_url" {
  value = local.tools_url
}

output "ecr_app_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecr_cp_repository_url" {
  value = aws_ecr_repository.cp.repository_url
}

output "s3_bucket" {
  value = aws_s3_bucket.main.bucket
}

output "codebuild_project" {
  value = aws_codebuild_project.app.name
}

output "github_connection_arn" {
  description = "作成後にコンソールで 1 度 GitHub の認可を済ませる(PENDING → AVAILABLE)"
  value       = aws_codeconnections_connection.github.arn
}

output "lambda_functions" {
  value = {
    cp     = aws_lambda_function.cp.function_name
    app    = aws_lambda_function.app.function_name
    worker = aws_lambda_function.worker.function_name
  }
}

output "rds_proxy_endpoint" {
  value = aws_db_proxy.main.endpoint
}

output "rds_instance_endpoint" {
  description = "bootstrap.sql を流すときに使う(踏み台から)"
  value       = aws_db_instance.main.address
}

output "db_secret_arns" {
  value = {
    master = aws_secretsmanager_secret.db_master.arn
    cp     = aws_secretsmanager_secret.db_cp.arn
    app    = aws_secretsmanager_secret.db_app.arn
  }
}
