output "tasks_security_group_id" {
  description = "ID of the security group for ECS tasks."
  value       = aws_security_group.tasks.id
}

output "database_security_group_id" {
  description = "ID of the security group for the database."
  value       = aws_security_group.database.id
}
