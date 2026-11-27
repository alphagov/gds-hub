# CloudFront in front of the Express load balancer, on its default
# *.cloudfront.net domain. The address allow-list and the rate limit live in a
# CLOUDFRONT-scope web ACL here, because once CloudFront is in front the
# regional web ACL only sees CloudFront's addresses. CloudFront adds a secret
# X-Origin-Verify header to every origin request, and the regional web ACL
# (modules/edge) blocks any request without it, so the Express URL can't be
# used directly.
#
# Pages aren't cached: each one carries a per-request CSP nonce, and /edit/*,
# preview and /search must never be cached. Only /assets/* is cached.

resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

# CLOUDFRONT-scope WAF resources must be created in us-east-1.
resource "aws_wafv2_ip_set" "allowed" {
  provider = aws.us_east_1

  name               = "${var.name}-allowed"
  description        = "Address ranges allowed to reach the GDS Hub."
  scope              = "CLOUDFRONT"
  ip_address_version = "IPV4"
  addresses          = var.allowed_cidrs
}

resource "aws_wafv2_web_acl" "this" {
  provider = aws.us_east_1

  name        = "${var.name}-cdn"
  description = "Block everything except the allowed address ranges."
  scope       = "CLOUDFRONT"

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
      metric_name                = "${var.name}-cdn-rate-limit"
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
      metric_name                = "${var.name}-cdn-allowed"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-cdn"
    sampled_requests_enabled   = true
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Forwards the viewer's headers, cookies and query strings, but not Host: the
# Express load balancer routes on Host, so it must get its own name.
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

locals {
  origin_id = "express"

  # The Express endpoint may be given with a scheme or a trailing slash.
  origin_domain = trimsuffix(replace(coalesce(var.origin_domain, "-"), "/^https?:\\/\\//", ""), "/")
}

resource "aws_cloudfront_distribution" "this" {
  count = var.create_distribution ? 1 : 0

  enabled      = true
  comment      = var.name
  price_class  = var.price_class
  http_version = "http2and3"
  web_acl_id   = aws_wafv2_web_acl.this.arn

  # The allow-list is IPv4 only, so IPv6 viewers would always be blocked.
  is_ipv6_enabled = false

  origin {
    origin_id   = local.origin_id
    domain_name = local.origin_domain

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  default_cache_behavior {
    target_origin_id         = local.origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = local.origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  lifecycle {
    precondition {
      condition     = var.origin_domain != null && var.origin_domain != ""
      error_message = "origin_domain must be set to the Express endpoint when create_distribution is true."
    }
  }
}
