# The role the deploy workflow assumes through GitHub's OIDC provider, so no AWS
# keys are stored in GitHub. It can push images, register and run the schema
# migration task, and update the service. It has no S3 access and can't start
# the data migration task.

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  subject = coalesce(var.github_subject, "repo:${var.github_repository}:environment:${var.github_environment}")

  ecs_arn_prefix = "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}"
}

# Trust: only this repository's jobs in this environment, with the right audience.
# Without the sub check, any GitHub repository could assume the role.
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.subject]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "${var.name}-deploy"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [var.ecr_repository_arn]
  }

  # These two don't support restricting by resource.
  statement {
    sid       = "TaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid       = "RunSchemaMigration"
    actions   = ["ecs:RunTask"]
    resources = ["${local.ecs_arn_prefix}:task-definition/${var.schema_migration_task_family}:*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid       = "WatchTasks"
    actions   = ["ecs:DescribeTasks"]
    resources = ["${local.ecs_arn_prefix}:task/${var.cluster_name}/*"]
  }

  dynamic "statement" {
    for_each = var.service_enabled ? [1] : []

    content {
      sid       = "UpdateService"
      actions   = ["ecs:DescribeExpressGatewayService", "ecs:UpdateExpressGatewayService"]
      resources = [var.service_arn]
    }
  }

  statement {
    sid       = "PassTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [var.execution_role_arn, var.app_task_role_arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "ReadSchemaMigrationLogs"
    actions   = ["logs:GetLogEvents"]
    resources = ["${var.schema_migration_log_group_arn}:log-stream:*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
