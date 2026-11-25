variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "database_secret_arn" {
  description = "ARN of the secret RDS manages for the master user (from the database module). The execution role may read this one secret."
  type        = string
  sensitive   = true
}

variable "migration_bucket_arn" {
  description = "ARN of the data migration bucket (from the storage module)."
  type        = string
  sensitive   = true
}
