variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider (the bootstrap stack's github_oidc_provider_arn output)."
  type        = string
  sensitive   = true
}

variable "github_repository" {
  description = "The repository whose workflows may assume the role, as \"owner/name\"."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like \"owner/name\"."
  }
}

variable "github_environment" {
  description = "The GitHub environment the deploy job runs in. Only jobs in this environment can assume the role."
  type        = string
  default     = "development"
}

variable "github_subject" {
  description = "The exact token subject to trust, if the repository's tokens don't use the default \"repo:owner/name:environment:name\" form (newer repositories can use an immutable form). Leave null for the default."
  type        = string
  default     = null
  sensitive   = true
}

variable "ecr_repository_arn" {
  description = "ARN of the ECR repository the workflow pushes to (from the storage module)."
  type        = string
  sensitive   = true
}

variable "execution_role_arn" {
  description = "ARN of the ECS execution role (from the iam module). The workflow passes it to task definitions."
  type        = string
  sensitive   = true
}

variable "app_task_role_arn" {
  description = "ARN of the app's task role (from the iam module). The workflow passes it to task definitions."
  type        = string
  sensitive   = true
}

variable "cluster_arn" {
  description = "ARN of the ECS cluster (from the service module)."
  type        = string
  sensitive   = true
}

variable "cluster_name" {
  description = "Name of the ECS cluster (from the service module)."
  type        = string
}

variable "schema_migration_task_family" {
  description = "Family of the schema migration task definition (from the service module). The role can run only this family."
  type        = string
}

variable "schema_migration_log_group_arn" {
  description = "ARN of the schema migration task's log group (from the storage module)."
  type        = string
  sensitive   = true
}

variable "service_enabled" {
  description = "Whether the Express service exists. Set it to the service module's create_service."
  type        = bool
  default     = false
}

variable "service_arn" {
  description = "ARN of the Express service (from the service module). Only read when service_enabled is true."
  type        = string
  default     = null
  sensitive   = true
}
