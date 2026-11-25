# The places things are kept: the container image repository, the bucket the
# data migration reads its inputs from and writes its reports to, and the log
# groups.

data "aws_caller_identity" "current" {}

# ECR

resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Remove untagged images after 7 days."
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the latest ${var.images_to_keep} images."
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.images_to_keep
        }
        action = { type = "expire" }
      },
    ]
  })
}

# Data migration bucket. Bucket names are global, so the account ID keeps the
# name unique without writing one in the repo. The inputs/ and reports/ prefixes
# need no resources: they exist once something is written under them.

resource "aws_s3_bucket" "migration" {
  bucket = "${var.name}-data-migration-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "migration" {
  bucket = aws_s3_bucket.migration.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "migration" {
  bucket = aws_s3_bucket.migration.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "migration" {
  bucket = aws_s3_bucket.migration.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "migration" {
  bucket = aws_s3_bucket.migration.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "migration_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.migration.arn, "${aws_s3_bucket.migration.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "migration" {
  bucket = aws_s3_bucket.migration.id
  policy = data.aws_iam_policy_document.migration_bucket.json

  # The public access block and the policy are applied one after the other.
  depends_on = [aws_s3_bucket_public_access_block.migration]
}

# Log groups

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name}/app"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "schema_migration" {
  name              = "/ecs/${var.name}/schema-migration"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "data_migration" {
  name              = "/ecs/${var.name}/data-migration"
  retention_in_days = var.log_retention_days
}
