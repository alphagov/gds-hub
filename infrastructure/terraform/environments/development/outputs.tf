# Most of these become GitHub environment variables for the deploy workflow.
# This repository is public and CI logs are publicly downloadable, so every
# output is marked sensitive, as in the bootstrap stack. Add sensitive = true
# to any new output. Read values with terraform output -raw <name>.

output "deploy_role_arn" {
  description = "ARN of the role the deploy workflow assumes."
  value       = module.deploy_role.role_arn
  sensitive   = true
}

output "region" {
  description = "AWS region."
  value       = var.region
  sensitive   = true
}

output "ecr_repository_url" {
  description = "URL of the ECR repository the workflow pushes to."
  value       = module.storage.ecr_repository_url
  sensitive   = true
}

output "cluster_name" {
  description = "Name of the ECS cluster."
  value       = module.service.cluster_name
  sensitive   = true
}

output "service_arn" {
  description = "ARN of the Express service, or null until create_service is true."
  value       = module.service.service_arn
  sensitive   = true
}

output "service_url" {
  description = "Address of the service's load balancer, or null until create_service is true."
  value       = module.service.service_url
  sensitive   = true
}

output "schema_migration_task_family" {
  description = "Family of the schema migration task definition."
  value       = module.service.schema_migration_task_family
  sensitive   = true
}

output "data_migration_task_family" {
  description = "Family of the data migration task definition."
  value       = module.service.data_migration_task_family
  sensitive   = true
}

output "public_subnet_ids" {
  description = "IDs of the public subnets, for one-off tasks."
  value       = module.network.public_subnet_ids
  sensitive   = true
}

output "tasks_security_group_id" {
  description = "ID of the security group for one-off tasks."
  value       = module.security.tasks_security_group_id
  sensitive   = true
}

output "database_address" {
  description = "The database's endpoint name."
  value       = module.database.address
  sensitive   = true
}

output "database_secret_arn" {
  description = "ARN of the RDS-managed secret holding the master user name and password."
  value       = module.database.master_user_secret_arn
  sensitive   = true
}

output "migration_bucket_name" {
  description = "Name of the data migration bucket."
  value       = module.storage.migration_bucket_name
  sensitive   = true
}

output "load_balancer_arn" {
  description = "ARN of the load balancer the web ACL is attached to, or null before the association exists."
  value       = module.edge.load_balancer_arn
  sensitive   = true
}
