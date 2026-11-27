output "domain_name" {
  description = "The distribution's *.cloudfront.net domain, or null while create_distribution is false."
  value       = one(aws_cloudfront_distribution.this[*].domain_name)
  sensitive   = true
}

output "distribution_arn" {
  description = "ARN of the distribution, or null while create_distribution is false."
  value       = one(aws_cloudfront_distribution.this[*].arn)
  sensitive   = true
}

output "web_acl_arn" {
  description = "ARN of the CLOUDFRONT-scope web ACL."
  value       = aws_wafv2_web_acl.this.arn
  sensitive   = true
}

output "origin_verify_secret" {
  description = "Value of the X-Origin-Verify header CloudFront sends to the origin. The regional web ACL allows only requests that carry it."
  value       = random_password.origin_verify.result
  sensitive   = true
}
