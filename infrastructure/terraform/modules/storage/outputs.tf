output "ecr_repository_url" {
  description = "URL of the ECR repository, without a tag."
  value       = aws_ecr_repository.this.repository_url
}

output "ecr_repository_arn" {
  description = "ARN of the ECR repository."
  value       = aws_ecr_repository.this.arn
}

output "migration_bucket_name" {
  description = "Name of the data migration bucket."
  value       = aws_s3_bucket.migration.id
}

output "migration_bucket_arn" {
  description = "ARN of the data migration bucket."
  value       = aws_s3_bucket.migration.arn
}

output "app_log_group_name" {
  description = "Name of the app's log group."
  value       = aws_cloudwatch_log_group.app.name
}

output "schema_migration_log_group_name" {
  description = "Name of the schema migration task's log group."
  value       = aws_cloudwatch_log_group.schema_migration.name
}

output "schema_migration_log_group_arn" {
  description = "ARN of the schema migration task's log group."
  value       = aws_cloudwatch_log_group.schema_migration.arn
}

output "data_migration_log_group_name" {
  description = "Name of the data migration task's log group."
  value       = aws_cloudwatch_log_group.data_migration.name
}
