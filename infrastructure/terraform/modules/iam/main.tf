# The four roles the service and the one-off tasks run as. The GitHub deploy
# role is in the deploy-role module, because it needs outputs from the service.

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs.amazonaws.com"]
    }
  }
}

# Execution role: pulls the image, writes logs and reads the database secret
# before the container starts. The tasks themselves get no Secrets Manager access.

resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.database_secret_arn]
  }
}

resource "aws_iam_role_policy" "execution_secret" {
  name   = "read-database-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secret.json
}

# Infrastructure role: lets Express Mode create and manage the load balancer
# and its other resources.

data "aws_iam_policy" "infrastructure" {
  name = "AmazonECSInfrastructureRoleforExpressGatewayServices"
}

resource "aws_iam_role" "infrastructure" {
  name               = "${var.name}-infrastructure"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "infrastructure" {
  role       = aws_iam_role.infrastructure.name
  policy_arn = data.aws_iam_policy.infrastructure.arn
}

# App task role: what the running app is allowed to do in AWS. Nothing.

resource "aws_iam_role" "app_task" {
  name               = "${var.name}-app-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# Data migration task role: reads the inputs and writes the reports, and
# nothing else. The schema migration task uses the app task role.

resource "aws_iam_role" "data_migration_task" {
  name               = "${var.name}-data-migration-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "data_migration_task" {
  statement {
    sid       = "ListInputsAndReports"
    actions   = ["s3:ListBucket"]
    resources = [var.migration_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["inputs/*", "reports/*"]
    }
  }

  statement {
    sid       = "ReadInputs"
    actions   = ["s3:GetObject"]
    resources = ["${var.migration_bucket_arn}/inputs/*"]
  }

  statement {
    sid       = "WriteReports"
    actions   = ["s3:PutObject"]
    resources = ["${var.migration_bucket_arn}/reports/*"]
  }
}

resource "aws_iam_role_policy" "data_migration_task" {
  name   = "inputs-and-reports"
  role   = aws_iam_role.data_migration_task.id
  policy = data.aws_iam_policy_document.data_migration_task.json
}
