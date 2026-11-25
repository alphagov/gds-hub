variable "region" {
  description = "AWS region for the development environment."
  type        = string
  default     = "eu-west-2"
}

variable "allowed_cidrs" {
  description = "IPv4 address ranges allowed to reach the service. Set them only in the git-ignored terraform.tfvars."
  type        = list(string)
}

variable "github_oidc_provider_arn" {
  description = "ARN of the GitHub OIDC provider: the bootstrap stack's github_oidc_provider_arn output."
  type        = string
}

variable "github_repository" {
  description = "The repository whose deploy workflow may assume the deploy role, as \"owner/name\"."
  type        = string
  default     = "alphagov/gds-hub"
}

variable "github_environment" {
  description = "The GitHub environment the deploy job runs in."
  type        = string
  default     = "development"
}

variable "github_subject" {
  description = "The exact OIDC token subject to trust, if the repository doesn't use the default \"repo:owner/name:environment:name\" form. Leave null for the default."
  type        = string
  default     = null
}

variable "create_service" {
  description = "Create the Express service and attach the WAF. Leave false for the first apply; set true once the first image is pushed and the schema migrated."
  type        = bool
  default     = false
}

variable "app_image" {
  description = "The image the service starts with, by digest. Needed when create_service is true."
  type        = string
  default     = ""
}

variable "alb_arn" {
  description = "ARN of the load balancer Express Mode created, if looking it up by tag doesn't work."
  type        = string
  default     = ""
}

variable "rotate_database_password" {
  description = "Leave RDS's automatic rotation of the master password on. Off in development, because running tasks keep the old password until they restart."
  type        = bool
  default     = false
}

variable "database_deletion_protection" {
  description = "Stop the database being deleted."
  type        = bool
  default     = false
}
