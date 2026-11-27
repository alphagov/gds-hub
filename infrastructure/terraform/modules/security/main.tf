# The tasks (the app and both migration tasks) and the database each get a
# security group. Express Mode creates its own groups for the load balancer and
# adds ours alongside them, and the groups' rules add together. So the
# outbound limit on the task group may not narrow what a task can reach.
# Check the rules Express Mode adds on the first apply.

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "ECS tasks: the app and the migration tasks."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-tasks" }
}

resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "The RDS database. Reachable from the tasks only."
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-database" }
}

# HTTPS out: pulling the image, Secrets Manager, CloudWatch Logs, S3.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  security_group_id = aws_security_group.tasks.id
  description       = "HTTPS to AWS services and the image registry."
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "tasks_to_database" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "PostgreSQL to the database."
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_tasks" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the tasks."
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.tasks.id
}
