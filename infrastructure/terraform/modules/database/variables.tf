variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "private_subnet_ids" {
  description = "IDs of the private subnets the database runs in."
  type        = list(string)
}

variable "security_group_id" {
  description = "ID of the security group for the database (from the security module)."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL version. A major version only (\"18\") lets RDS pick the minor version. Check it is offered in the region."
  type        = string
  default     = "18"
}

variable "parameter_group_family" {
  description = "Parameter group family for the engine version."
  type        = string
  default     = "postgres18"
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Storage in GiB (gp3)."
  type        = number
  default     = 20
}

variable "database_name" {
  description = "Name of the database the app uses."
  type        = string
  default     = "hub"
}

variable "master_username" {
  description = "Master user name. The app and the migration tasks connect as this user for now."
  type        = string
  default     = "hub_admin"
}

variable "deletion_protection" {
  description = "Stop the database being deleted. Off in development; production sets it to true."
  type        = bool
  default     = false
}

variable "rotate_master_password" {
  description = "Leave RDS's automatic rotation of the master password on (every 7 days). Running tasks keep the old password until they restart, so development turns it off."
  type        = bool
  default     = false
}
