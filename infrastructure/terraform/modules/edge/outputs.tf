output "web_acl_arn" {
  description = "ARN of the web ACL."
  value       = aws_wafv2_web_acl.this.arn
}

output "load_balancer_arn" {
  description = "ARN of the load balancer the web ACL is attached to, or null before the association exists."
  value       = var.associate_with_service ? local.alb_arn : null
}
