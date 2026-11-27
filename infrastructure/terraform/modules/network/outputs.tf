output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
  sensitive   = true
}

output "public_subnet_ids" {
  description = "IDs of the public subnets, one per availability zone."
  value       = aws_subnet.public[*].id
  sensitive   = true
}

output "private_subnet_ids" {
  description = "IDs of the private subnets, one per availability zone."
  value       = aws_subnet.private[*].id
  sensitive   = true
}
