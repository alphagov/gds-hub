# RDS PostgreSQL. RDS creates and owns the master password in Secrets Manager
# (manage_master_user_password), so it never appears in Terraform state, the
# repo or GitHub. ECS injects it into the tasks.

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.private_subnet_ids

  tags = { Name = var.name }
}

# rds.force_ssl is already 1 on PostgreSQL 15 and later. It's set so that
# requiring TLS is visible here. RDS reports it with apply_method
# "pending-reboot", so it's set to match, or every plan would show a change.
resource "aws_db_parameter_group" "this" {
  name        = var.name
  family      = var.parameter_group_family
  description = "GDS Hub: require TLS."

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  tags = { Name = var.name }
}

resource "aws_db_instance" "this" {
  identifier = var.name

  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                     = var.database_name
  username                    = var.master_username
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period   = 7
  copy_tags_to_snapshot     = true
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final-snapshot"

  auto_minor_version_upgrade = true
}

# Turns off the automatic rotation of the managed secret while keeping the
# secret. Referencing the instance's secret ARN makes this apply after the
# instance is available.
resource "aws_secretsmanager_secret_rotation" "master" {
  count = var.rotate_master_password ? 0 : 1

  secret_id        = aws_db_instance.this.master_user_secret[0].secret_arn
  rotation_enabled = false
}
