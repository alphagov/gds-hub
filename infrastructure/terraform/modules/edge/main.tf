# A regional web ACL that blocks everything except the allowed address ranges,
# with a rate limit. Express Mode doesn't output its load balancer's ARN, so
# the association finds the load balancer by the AmazonECSManaged tag, unless
# alb_arn is set. Until the association exists the load balancer is public.

resource "aws_wafv2_ip_set" "allowed" {
  name               = "${var.name}-allowed"
  description        = "Address ranges allowed to reach the GDS Hub."
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.allowed_cidrs
}

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "Block everything except the allowed address ranges."
  scope       = "REGIONAL"

  default_action {
    block {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "allow-listed-addresses"
    priority = 2

    action {
      allow {}
    }

    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.allowed.arn
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-allowed"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

data "aws_lb" "express" {
  count = var.associate_with_service && var.alb_arn == "" ? 1 : 0

  tags = {
    AmazonECSManaged = "true"
  }
}

locals {
  alb_arn = var.alb_arn != "" ? var.alb_arn : one(data.aws_lb.express[*].arn)
}

resource "aws_wafv2_web_acl_association" "this" {
  count = var.associate_with_service ? 1 : 0

  resource_arn = local.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
