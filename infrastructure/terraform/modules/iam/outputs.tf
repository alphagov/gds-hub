output "execution_role_arn" {
  description = "ARN of the ECS execution role."
  value       = aws_iam_role.execution.arn
  sensitive   = true
}

output "infrastructure_role_arn" {
  description = "ARN of the role Express Mode uses to manage the service's infrastructure."
  value       = aws_iam_role.infrastructure.arn
  sensitive   = true
}

output "app_task_role_arn" {
  description = "ARN of the app's task role. The schema migration task uses it too."
  value       = aws_iam_role.app_task.arn
  sensitive   = true
}

output "data_migration_task_role_arn" {
  description = "ARN of the data migration task's role."
  value       = aws_iam_role.data_migration_task.arn
  sensitive   = true
}
