# A regional web ACL on the Express load balancer that allows only requests
# carrying CloudFront's secret X-Origin-Verify header (see modules/cdn), so the
# Express URL can't be used directly. The address allow-list and the rate limit
# are on CloudFront's web ACL: here every request comes from a CloudFront
# address. Express Mode doesn't output its load balancer's ARN, so the
# association finds the load balancer by the AmazonECSManaged tag, unless
# alb_arn is set. Until the association exists the load balancer is public.

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "Block everything except requests that come through CloudFront."
  scope       = "REGIONAL"

  default_action {
    block {}
  }

  rule {
    name     = "from-cloudfront"
    priority = 1

    action {
      allow {}
    }

    statement {
      byte_match_statement {
        search_string         = var.origin_verify_secret
        positional_constraint = "EXACTLY"

        field_to_match {
          single_header {
            name = "x-origin-verify"
          }
        }

        text_transformation {
          priority = 0
          type     = "NONE"
        }
      }
    }

    # No sampled requests: they would show the X-Origin-Verify value.
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-from-cloudfront"
      sampled_requests_enabled   = false
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
