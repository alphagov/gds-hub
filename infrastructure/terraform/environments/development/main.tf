# The development environment, built from the modules in dependency order:
#
#   network -> security -> database -> storage -> iam -> service -> cdn -> edge
#                                                              \-> deploy_role
#
# Each module takes only what the ones before it output. The service, the
# CloudFront distribution and the WAF association are created in a second
# apply (create_service), once the first image has been pushed and the schema
# migrated.

locals {
  name = "hub-development"
}

module "network" {
  source = "../../modules/network"

  name = local.name
}

module "security" {
  source = "../../modules/security"

  name   = local.name
  vpc_id = module.network.vpc_id
}

module "database" {
  source = "../../modules/database"

  name                   = local.name
  private_subnet_ids     = module.network.private_subnet_ids
  security_group_id      = module.security.database_security_group_id
  deletion_protection    = var.database_deletion_protection
  rotate_master_password = var.rotate_database_password
}

module "storage" {
  source = "../../modules/storage"

  name = local.name
}

module "iam" {
  source = "../../modules/iam"

  name                 = local.name
  database_secret_arn  = module.database.master_user_secret_arn
  migration_bucket_arn = module.storage.migration_bucket_arn
}

module "service" {
  source = "../../modules/service"

  name                            = local.name
  region                          = var.region
  subnet_ids                      = module.network.public_subnet_ids
  security_group_id               = module.security.tasks_security_group_id
  execution_role_arn              = module.iam.execution_role_arn
  infrastructure_role_arn         = module.iam.infrastructure_role_arn
  app_task_role_arn               = module.iam.app_task_role_arn
  data_migration_task_role_arn    = module.iam.data_migration_task_role_arn
  database_address                = module.database.address
  database_port                   = module.database.port
  database_name                   = module.database.database_name
  database_secret_arn             = module.database.master_user_secret_arn
  ecr_repository_url              = module.storage.ecr_repository_url
  app_log_group_name              = module.storage.app_log_group_name
  schema_migration_log_group_name = module.storage.schema_migration_log_group_name
  data_migration_log_group_name   = module.storage.data_migration_log_group_name
  create_service                  = var.create_service
  app_image                       = var.app_image

  # CloudFront and the load balancer both add to X-Forwarded-For.
  trust_proxy_hops = 2

  # The roles' policy attachments must exist before the service is created,
  # or deleting it can fail while the roles are still draining.
  depends_on = [module.iam]
}

module "cdn" {
  source = "../../modules/cdn"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name                = local.name
  allowed_cidrs       = var.allowed_cidrs
  create_distribution = var.create_service
  origin_domain       = module.service.service_url
}

module "edge" {
  source = "../../modules/edge"

  name                   = local.name
  origin_verify_secret   = module.cdn.origin_verify_secret
  associate_with_service = var.create_service
  alb_arn                = var.alb_arn

  # The load balancer lookup must wait until the service has created it, and
  # the web ACL must only start requiring CloudFront's header once the
  # distribution is deployed.
  depends_on = [module.service, module.cdn]
}

module "deploy_role" {
  source = "../../modules/deploy-role"

  name                           = local.name
  github_oidc_provider_arn       = var.github_oidc_provider_arn
  github_repository              = var.github_repository
  github_environment             = var.github_environment
  github_subject                 = var.github_subject
  ecr_repository_arn             = module.storage.ecr_repository_arn
  execution_role_arn             = module.iam.execution_role_arn
  app_task_role_arn              = module.iam.app_task_role_arn
  cluster_arn                    = module.service.cluster_arn
  cluster_name                   = module.service.cluster_name
  schema_migration_task_family   = module.service.schema_migration_task_family
  schema_migration_log_group_arn = module.storage.schema_migration_log_group_arn
  service_enabled                = var.create_service
  service_arn                    = module.service.service_arn
}
