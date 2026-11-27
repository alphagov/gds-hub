variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "allowed_cidrs" {
  description = "IPv4 address ranges allowed to reach the service. Everything else is blocked."
  type        = list(string)
  sensitive   = true

  validation {
    condition     = length(var.allowed_cidrs) > 0 && alltrue([for cidr in var.allowed_cidrs : can(cidrhost(cidr, 0)) && !strcontains(cidr, ":")])
    error_message = "allowed_cidrs must be a non-empty list of valid IPv4 CIDR blocks."
  }
}

variable "rate_limit" {
  description = "Most requests from one address in five minutes before it is blocked."
  type        = number
  default     = 2000
}

variable "create_distribution" {
  description = "Create the CloudFront distribution. Set it to the same value as the service module's create_service, so the origin exists."
  type        = bool
  default     = false
}

variable "origin_domain" {
  description = "The Express service's endpoint: the service module's service_url output."
  type        = string
  default     = null
  sensitive   = true
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 serves from North America and Europe only."
  type        = string
  default     = "PriceClass_100"
}
