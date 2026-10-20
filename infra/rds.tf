# RDS MySQL 8.0 + RDS Proxy。
# database とユーザー(okiba_platform / okiba_tools / okiba_cp / okiba_app)は Terraform では
# 作れないので、apply 後に sql/bootstrap.sql を流す(README 参照)。

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "okiba RDS: Lambda と RDS Proxy からのみ"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id, aws_security_group.rds_proxy.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds_proxy" {
  name        = "${var.project}-rds-proxy"
  description = "okiba RDS Proxy: Lambda からのみ"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = var.private_subnet_ids
}

# ---- パスワード(Secrets Manager に置き、RDS Proxy の認証にも使う) ----

resource "random_password" "master" {
  length  = 32
  special = false
}

resource "random_password" "cp_user" {
  length  = 32
  special = false
}

resource "random_password" "app_user" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_master" {
  name = "${var.project}/db/master"
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id     = aws_secretsmanager_secret.db_master.id
  secret_string = jsonencode({ username = "okiba_admin", password = random_password.master.result })
}

resource "aws_secretsmanager_secret" "db_cp" {
  name = "${var.project}/db/okiba_cp"
}

resource "aws_secretsmanager_secret_version" "db_cp" {
  secret_id     = aws_secretsmanager_secret.db_cp.id
  secret_string = jsonencode({ username = "okiba_cp", password = random_password.cp_user.result })
}

resource "aws_secretsmanager_secret" "db_app" {
  name = "${var.project}/db/okiba_app"
}

resource "aws_secretsmanager_secret_version" "db_app" {
  secret_id     = aws_secretsmanager_secret.db_app.id
  secret_string = jsonencode({ username = "okiba_app", password = random_password.app_user.result })
}

# ---- インスタンス ----

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-mysql"
  engine         = "mysql"
  engine_version = "8.0"
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  username = "okiba_admin"
  password = random_password.master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false # SC-2

  backup_retention_period = 7
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.project}-mysql-final"

  apply_immediately = false
}

# ---- RDS Proxy(Lambda からの接続数を抑える) ----

resource "aws_iam_role" "rds_proxy" {
  name = "${var.project}-rds-proxy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "rds_proxy" {
  name = "secrets"
  role = aws_iam_role.rds_proxy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.db_master.arn,
        aws_secretsmanager_secret.db_cp.arn,
        aws_secretsmanager_secret.db_app.arn,
      ]
    }]
  })
}

resource "aws_db_proxy" "main" {
  name                   = "${var.project}-proxy"
  engine_family          = "MYSQL"
  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_subnet_ids         = var.private_subnet_ids
  vpc_security_group_ids = [aws_security_group.rds_proxy.id]
  require_tls            = true
  idle_client_timeout    = 1800

  # Proxy を通る DB ユーザーごとに auth が必要
  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.db_master.arn
  }

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.db_cp.arn
  }

  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.db_app.arn
  }
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.main.name

  connection_pool_config {
    max_connections_percent      = 90
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name          = aws_db_proxy.main.name
  target_group_name      = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.main.identifier
}
