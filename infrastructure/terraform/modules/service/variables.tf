variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "region" {
  description = "AWS region, passed to the app and the logs."
  type        = string
}

variable "subnet_ids" {
  description = "IDs of the public subnets for the load balancer and tasks (from the network module). Express Mode needs at least two."
  type        = list(string)
}

variable "security_group_id" {
  description = "ID of the security group for tasks (from the security module)."
  type        = string
}

variable "execution_role_arn" {
  description = "ARN of the ECS execution role (from the iam module)."
  type        = string
}

variable "infrastructure_role_arn" {
  description = "ARN of the Express Mode infrastructure role (from the iam module)."
  type        = string
}

variable "app_task_role_arn" {
  description = "ARN of the app's task role (from the iam module). The schema migration task uses it too."
  type        = string
}

variable "data_migration_task_role_arn" {
  description = "ARN of the data migration task's role (from the iam module)."
  type        = string
}

variable "database_address" {
  description = "The database's endpoint name (from the database module)."
  type        = string
}

variable "database_port" {
  description = "The database's port (from the database module)."
  type        = number
}

variable "database_name" {
  description = "Name of the database (from the database module)."
  type        = string
}

variable "database_secret_arn" {
  description = "ARN of the secret RDS manages for the master user (from the database module)."
  type        = string
}

variable "ecr_repository_url" {
  description = "URL of the ECR repository (from the storage module)."
  type        = string
}

variable "app_log_group_name" {
  description = "Name of the app's log group (from the storage module)."
  type        = string
}

variable "schema_migration_log_group_name" {
  description = "Name of the schema migration task's log group (from the storage module)."
  type        = string
}

variable "data_migration_log_group_name" {
  description = "Name of the data migration task's log group (from the storage module)."
  type        = string
}

variable "create_service" {
  description = "Create the Express service. Leave false until the first image has been pushed and the schema migrated."
  type        = bool
  default     = false
}

variable "app_image" {
  description = "Image the service starts with, by digest, for example \"<repository url>@sha256:...\". Needed when create_service is true. Later deploys change the image outside Terraform."
  type        = string
  default     = ""
}

variable "container_port" {
  description = "Port the app listens on."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "Path the load balancer checks."
  type        = string
  default     = "/health"
}

variable "cpu" {
  description = "CPU units for each app task (1024 is one vCPU)."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Memory in MiB for each app task."
  type        = number
  default     = 1024
}

variable "min_task_count" {
  description = "Fewest app tasks."
  type        = number
  default     = 1
}

variable "max_task_count" {
  description = "Most app tasks."
  type        = number
  default     = 2
}

variable "trust_proxy_hops" {
  description = "How many proxies sit in front of the app (the load balancer is one). Read by the app as TRUST_PROXY_HOPS."
  type        = number
  default     = 1
}

variable "migration_task_cpu" {
  description = "CPU units for the migration tasks."
  type        = number
  default     = 512
}

variable "migration_task_memory" {
  description = "Memory in MiB for the migration tasks."
  type        = number
  default     = 1024
}
