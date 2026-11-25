variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the app and migration task logs."
  type        = number
  default     = 30
}

variable "images_to_keep" {
  description = "How many tagged images the ECR lifecycle policy keeps."
  type        = number
  default     = 30
}
