variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC the security groups belong to."
  type        = string
}
