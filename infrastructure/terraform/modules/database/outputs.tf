output "address" {
  description = "The database's endpoint name. The app connects to this name, so verify-full matches the certificate."
  value       = aws_db_instance.this.address
  sensitive   = true
}

output "port" {
  description = "The database's port."
  value       = aws_db_instance.this.port
  sensitive   = true
}

output "database_name" {
  description = "Name of the database the app uses."
  value       = aws_db_instance.this.db_name
  sensitive   = true
}

output "master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret RDS manages for the master user. It holds the user name and password."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
  sensitive   = true
}
