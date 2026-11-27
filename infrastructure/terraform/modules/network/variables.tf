variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block of the VPC. It is split into /20 subnets: three public and three private."
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 16
    error_message = "vpc_cidr must be a valid CIDR block no smaller than a /16."
  }
}
