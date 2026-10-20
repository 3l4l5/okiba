# SSO の関門。CP とツールアプリの前段で、Google の OIDC 認証を強制する(SC-1)。
#
# 443/80 は 0.0.0.0/0 から受ける。組織のユーザーに限定するのは ALB ではなく、
# Google の OAuth 同意画面を「Internal」にすることと、アプリ側の OKIBA_ALLOWED_DOMAIN で行う
# (ALB の authenticate-oidc 単体ではドメインを制限できないため)。

resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "okiba ALB"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "main" {
  name               = "${var.project}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  drop_invalid_header_fields = true
}

# HTTP は HTTPS へ
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  # ホスト名が一致しないリクエストは何も返さない
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

# ---- ターゲットグループ(Lambda) ----

resource "aws_lb_target_group" "cp" {
  name        = "${var.project}-cp"
  target_type = "lambda"
}

resource "aws_lb_target_group" "app" {
  name        = "${var.project}-app"
  target_type = "lambda"
}

resource "aws_lambda_permission" "alb_cp" {
  statement_id  = "AllowALBInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cp.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.cp.arn
}

resource "aws_lambda_permission" "alb_app" {
  statement_id  = "AllowALBInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.app.arn
}

resource "aws_lb_target_group_attachment" "cp" {
  target_group_arn = aws_lb_target_group.cp.arn
  target_id        = aws_lambda_function.cp.arn
  depends_on       = [aws_lambda_permission.alb_cp]
}

resource "aws_lb_target_group_attachment" "app" {
  target_group_arn = aws_lb_target_group.app.arn
  target_id        = aws_lambda_function.app.arn
  depends_on       = [aws_lambda_permission.alb_app]
}

# ---- リスナールール ----
# 優先度は小さいほど先に評価される。
#   10: CP の内部エンドポイント(/api/internal/*)は外から到達させない
#   20: CP の Upload Token API は OIDC を通さない
#   30: ツールアプリの /healthz は OIDC を通さない
#  100: CP(OIDC あり)
#  110: ツールアプリ(OIDC あり)

resource "aws_lb_listener_rule" "cp_internal_deny" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }

  condition {
    host_header {
      values = [local.cp_host]
    }
  }

  condition {
    path_pattern {
      values = ["/api/internal/*"]
    }
  }
}

# AI エージェントは作成者の手元(ブラウザの外)で動き、Bearer の Upload Token で認証する。
# そのため、この 4 つの API だけは ALB の OIDC を通さずに CP に渡す(SC-1 の例外)。
resource "aws_lb_listener_rule" "cp_token_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.cp.arn
  }

  condition {
    host_header {
      values = [local.cp_host]
    }
  }

  condition {
    path_pattern {
      values = local.token_api_paths
    }
  }
}

resource "aws_lb_listener_rule" "app_healthz" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = [local.tools_host]
    }
  }

  condition {
    path_pattern {
      values = ["/healthz"]
    }
  }
}

resource "aws_lb_listener_rule" "cp" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type  = "authenticate-oidc"
    order = 1

    authenticate_oidc {
      issuer                 = "https://accounts.google.com"
      authorization_endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
      token_endpoint         = "https://oauth2.googleapis.com/token"
      user_info_endpoint     = "https://openidconnect.googleapis.com/v1/userinfo"
      client_id              = var.google_client_id
      client_secret          = var.google_client_secret
      scope                  = "openid email profile"
      session_timeout        = 86400
      on_unauthenticated_request = "authenticate"
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.cp.arn
  }

  condition {
    host_header {
      values = [local.cp_host]
    }
  }
}

resource "aws_lb_listener_rule" "app" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 110

  action {
    type  = "authenticate-oidc"
    order = 1

    authenticate_oidc {
      issuer                 = "https://accounts.google.com"
      authorization_endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
      token_endpoint         = "https://oauth2.googleapis.com/token"
      user_info_endpoint     = "https://openidconnect.googleapis.com/v1/userinfo"
      client_id              = var.google_client_id
      client_secret          = var.google_client_secret
      scope                  = "openid email profile"
      session_timeout        = 86400
      on_unauthenticated_request = "authenticate"
    }
  }

  action {
    type             = "forward"
    order            = 2
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = [local.tools_host]
    }
  }
}

# ---- DNS(任意) ----

resource "aws_route53_record" "cp" {
  count   = var.create_route53_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.cp_host
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "tools" {
  count   = var.create_route53_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.tools_host
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}
