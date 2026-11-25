output "ecr_repository_url" {
  description = "URL of the ECR repository, without a tag."
  value       = aws_ecr_repository.this.repository_url
  sensitive   = true
}

output "ecr_repository_arn" {
  description = "ARN of the ECR repository."
  value       = aws_ecr_repository.this.arn
  sensitive   = true
}

output "migration_bucket_name" {
  description = "Name of the data migration bucket."
  value       = aws_s3_bucket.migration.id
  sensitive   = true
}

output "migration_bucket_arn" {
  description = "ARN of the data migration bucket."
  value       = aws_s3_bucket.migration.arn
  sensitive   = true
}

output "app_log_group_name" {
  description = "Name of the app's log group."
  value       = aws_cloudwatch_log_group.app.name
  sensitive   = true
}

output "schema_migration_log_group_name" {
  description = "Name of the schema migration task's log group."
  value       = aws_cloudwatch_log_group.schema_migration.name
  sensitive   = true
}

output "schema_migration_log_group_arn" {
  description = "ARN of the schema migration task's log group."
  value       = aws_cloudwatch_log_group.schema_migration.arn
  sensitive   = true
}

output "data_migration_log_group_name" {
  description = "Name of the data migration task's log group."
  value       = aws_cloudwatch_log_group.data_migration.name
  sensitive   = true
}
