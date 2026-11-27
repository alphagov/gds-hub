output "state_bucket" {
  description = "Bucket name for the S3 backend of the environment stacks. Pass it to terraform init with -backend-config; don't commit it."
  value       = aws_s3_bucket.state.id
  sensitive   = true
}

output "state_bucket_region" {
  description = "Region of the state bucket."
  value       = var.region
  sensitive   = true
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider, for the deploy role's trust policy."
  value       = aws_iam_openid_connect_provider.github.arn
  sensitive   = true
}
