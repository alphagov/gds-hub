variable "environment" {
  description = "The environment this AWS account hosts. Run the stack once in each account."
  type        = string

  validation {
    condition     = contains(["development", "production"], var.environment)
    error_message = "environment must be \"development\" or \"production\"."
  }
}

variable "region" {
  description = "AWS region for the state bucket."
  type        = string
  default     = "eu-west-2"
}

variable "state_bucket_name" {
  description = "Name of the state bucket. Bucket names are global, so pick one that is hard to guess. Set it only in the git-ignored terraform.tfvars, never in the repo."
  type        = string
  sensitive   = true
}
