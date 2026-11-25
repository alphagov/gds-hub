variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "allowed_cidrs" {
  description = "IPv4 address ranges allowed to reach the service. Everything else is blocked."
  type        = list(string)

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

variable "associate_with_service" {
  description = "Attach the web ACL to the service's load balancer. Set it to the same value as the service module's create_service, so the load balancer exists."
  type        = bool
  default     = false
}

variable "alb_arn" {
  description = "ARN of the load balancer Express Mode created. Leave empty to look it up by its AmazonECSManaged tag."
  type        = string
  default     = ""
}
