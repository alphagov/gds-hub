output "role_arn" {
  description = "ARN of the deploy role. The workflow assumes it."
  value       = aws_iam_role.deploy.arn
}
