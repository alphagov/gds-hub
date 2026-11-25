# The cluster, the app service (ECS Express Mode) and the two one-off task
# definitions. All three run the same image, with the same database settings.
#
# The database user and password come from the RDS-managed secret's JSON keys.
# ECS reads them when a task starts, so they never appear in Terraform state.
#
# GitHub Actions owns the image: it registers new revisions of the schema
# migration task definition and updates the service. Terraform only creates the
# first ones, with a placeholder tag on the task definitions.

locals {
  database_environment = {
    NODE_ENV      = "production"
    AWS_REGION    = var.region
    DATABASE_HOST = var.database_address
    DATABASE_PORT = tostring(var.database_port)
    DATABASE_NAME = var.database_name
  }

  app_environment = merge(local.database_environment, {
    PORT             = tostring(var.container_port)
    TRUST_PROXY_HOPS = tostring(var.trust_proxy_hops)
  })

  database_secrets = {
    DATABASE_USER     = "${var.database_secret_arn}:username::"
    DATABASE_PASSWORD = "${var.database_secret_arn}:password::"
  }

  # The tag doesn't need to exist: the workflow registers revisions with the digest.
  placeholder_image = "${var.ecr_repository_url}:bootstrap"
}

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# The app

resource "aws_ecs_express_gateway_service" "this" {
  count = var.create_service ? 1 : 0

  service_name            = var.name
  cluster                 = aws_ecs_cluster.this.name
  execution_role_arn      = var.execution_role_arn
  infrastructure_role_arn = var.infrastructure_role_arn
  task_role_arn           = var.app_task_role_arn

  cpu                   = var.cpu
  memory                = var.memory
  health_check_path     = var.health_check_path
  wait_for_steady_state = true

  primary_container {
    image          = var.app_image
    container_port = var.container_port

    aws_logs_configuration {
      log_group         = var.app_log_group_name
      log_stream_prefix = "app"
    }

    dynamic "environment" {
      for_each = nonsensitive(toset(keys(local.app_environment)))

      content {
        name  = environment.key
        value = local.app_environment[environment.key]
      }
    }

    dynamic "secret" {
      for_each = nonsensitive(toset(keys(local.database_secrets)))

      content {
        name       = secret.key
        value_from = local.database_secrets[secret.key]
      }
    }
  }

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [var.security_group_id]
  }

  scaling_target {
    min_task_count = var.min_task_count
    max_task_count = var.max_task_count
  }

  lifecycle {
    # GitHub Actions deploys new images.
    ignore_changes = [primary_container[0].image]

    precondition {
      condition     = var.app_image != ""
      error_message = "Set app_image to the image digest before setting create_service to true."
    }
  }
}

# Schema migration: run by the deploy workflow before the service is updated.
# It uses the app's task role, which has no access to S3.

resource "aws_ecs_task_definition" "schema_migration" {
  family                   = "${var.name}-schema-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.migration_task_cpu
  memory                   = var.migration_task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.app_task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "schema-migration"
      image     = local.placeholder_image
      essential = true
      command   = ["node", "dist/db/scripts/migrate.js"]

      environment = [for key, value in local.database_environment : { name = key, value = value }]
      secrets     = [for key, value in local.database_secrets : { name = key, valueFrom = value }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.schema_migration_log_group_name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "schema-migration"
        }
      }
    }
  ])
}

# Data migration: run by hand by a developer, with a command override for
# inventory, load or verify. The default command fails on purpose, so starting
# the task without an override doesn't start the web app.

resource "aws_ecs_task_definition" "data_migration" {
  family                   = "${var.name}-data-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.migration_task_cpu
  memory                   = var.migration_task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.data_migration_task_role_arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "data-migration"
      image     = local.placeholder_image
      essential = true
      command   = ["node", "-e", "console.error('Give this task a command override.'); process.exit(1)"]

      environment = [for key, value in local.database_environment : { name = key, value = value }]
      secrets     = [for key, value in local.database_secrets : { name = key, valueFrom = value }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = var.data_migration_log_group_name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "data-migration"
        }
      }
    }
  ])
}
