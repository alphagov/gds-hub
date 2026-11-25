output "cluster_name" {
  description = "Name of the ECS cluster."
  value       = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  description = "ARN of the ECS cluster."
  value       = aws_ecs_cluster.this.arn
}

output "service_arn" {
  description = "ARN of the Express service, or null while create_service is false."
  value       = one(aws_ecs_express_gateway_service.this[*].service_arn)
}

output "service_url" {
  description = "Address of the service's load balancer, or null while create_service is false."
  value       = try(aws_ecs_express_gateway_service.this[0].ingress_paths[0].endpoint, null)
}

output "schema_migration_task_family" {
  description = "Family of the schema migration task definition. The deploy workflow registers revisions of it."
  value       = aws_ecs_task_definition.schema_migration.family
}

output "data_migration_task_family" {
  description = "Family of the data migration task definition."
  value       = aws_ecs_task_definition.data_migration.family
}
