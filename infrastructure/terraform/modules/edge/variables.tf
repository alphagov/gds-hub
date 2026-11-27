variable "name" {
  description = "Prefix for resource names, for example \"hub-development\"."
  type        = string
}

variable "origin_verify_secret" {
  description = "Value of the X-Origin-Verify header CloudFront sends: the cdn module's origin_verify_secret output."
  type        = string
  sensitive   = true
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
