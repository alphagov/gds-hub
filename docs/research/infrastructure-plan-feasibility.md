# Phase 13a infrastructure plan: feasibility and best-practice review

Reviewed: `infrastructure-plan.md` (Phase 13a) against `CLAUDE.md`. Research date: 2026-11-25.

Method: primary sources only (docs.aws.amazon.com, Terraform AWS provider docs and source, developer.hashicorp.com, docs.github.com, the aws-actions repository, Node.js and node-postgres sources). Nothing was run: no terraform, aws, docker or npm.

Scope note: the coordinator asked for sources limited to questions 1, 2 and 4, and everything else marked unverified. The file was already written when that message arrived, so sections 3, 5, 6 and 7 keep the sources fetched earlier, each cited with its URL. If you want the strict reading, treat those four sections as unverified.

Tags used below:

- **Verified**: the cited page says it.
- **Inferred**: follows from a cited page but is not stated there. Treat as a hypothesis to test.
- **Unverified**: no primary source reached. Listed again at the end.

Reading note: some pages were fetched through a summariser. Where a page returned no content (several ECS Express pages) I say so and did not use it.

## Summary of verdicts

| # | Question | Verdict | Main reason |
|---|---|---|---|
| 1 | Secrets Manager | Feasible with changes | ARN attribute and JSON-key syntax are right for ECS. Express Mode support for the `:username::` suffix is not documented. Rotation leaves running tasks stale and the plan has no remedy. |
| 2 | `aws_ecs_express_gateway_service` | Feasible with changes | Arguments confirmed. Need provider 6.50 or later. Task security group egress limit will not take effect. The load balancer ARN can be found with a tag lookup, so the manual `alb_arn` step can go. |
| 3 | RDS PostgreSQL 18 and TLS | Feasible with changes | 18.x exists. Availability in `eu-west-2` could not be checked. `rds.force_ssl` is already 1 by default. Prefer `sslrootcert` over `NODE_EXTRA_CA_CERTS`. |
| 4 | GitHub OIDC | Feasible with changes | `sub` and `aud` correct. Newer repositories use an immutable `sub`. No thumbprint needed. Deploy role needs extra actions and a `PassRole` condition. |
| 5 | Terraform and state | Feasible with changes | Require Terraform 1.11 or later. `prevent_destroy` and self-hosted bootstrap state are sound. `-backend-config` does not hide the name. |
| 6 | Security posture | Feasible with changes | Acceptable for development only, with the mitigations in section 6. |
| 7 | Errors and ordering | Defects found | The two-stage first apply cannot work as written. Several smaller gaps. |

## 1. Secrets Manager

**Verdict: Feasible with changes.**

| Claim in the plan | Finding |
|---|---|
| `manage_master_user_password = true` creates a secret with only `username` and `password` | **Unverified.** No AWS page lists the keys of an RDS-managed secret. The only structure documented is the generic rotation-template layout, which has more keys (`engine`, `host`, `dbname`, `port` and others): https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_secret_json_structure.html. The plan only reads `username` and `password`, so it does not depend on the claim, but "RDS stores only these two" should be removed or checked with `get-secret-value` after the first apply. |
| ARN attribute | **Verified.** `aws_db_instance.<name>.master_user_secret[0].secret_arn`. The provider docs say to reference it rather than hard-code it. Also exports `kms_key_id` and `secret_status`. https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/db_instance.html.markdown |
| Secret deleted with the instance | **Verified.** https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html |
| Default KMS key | **Verified.** If no `master_user_secret_kms_key_id`, the default key is used. The key cannot be changed once RDS manages the secret (rds-secrets-manager page above). |
| ECS `valueFrom` JSON-key syntax `<arn>:username::` | **Verified for ECS task definitions.** Syntax is `arn:...:secret:name:json-key:version-stage:version-id`, colons required if parts are omitted. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html. Fargate needs platform 1.4.0 or later for JSON keys (same page). |
| Express Mode accepts that syntax | **Unverified.** The Express container type uses the same `Secret` type, whose `valueFrom` text says only "the full ARN of the AWS Secrets Manager secret": https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Secret.html and https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ExpressGatewayContainer.html. The Terraform docs say `value_from` is "a Secrets Manager secret ARN or an SSM parameter ARN". The provider source declares it as an ARN type (https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/internal/service/ecs/express_gateway_service.go), and I could not confirm whether a suffixed value passes that type check. Test on the first apply. The provider has no `task_definition_arn` argument, so there is no fall-back to your own task definition through Terraform. |
| Execution role needs `secretsmanager:GetSecretValue` on the secret | **Verified.** https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html |
| `kms:Decrypt` for a customer-managed key | **Verified.** "Required only if your secret uses a customer managed key and not the default key", with the key ARN as a resource (same page). With the default `aws/secretsmanager` key the page says it is not required. |
| Rotation and running tasks | **Verified.** Secrets are injected at container start. "If the secret is subsequently updated or rotated, the container will not receive the updated value automatically." Launch a new task or force a new deployment (secrets-envvar page above, and https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data-secrets.html). |
| RDS rotation cadence | **Verified.** Every 7 days by default (rds-secrets-manager page; Terraform db_instance docs). New passwords are 28 characters with at least one punctuation mark, so URL-encoding in `src/config.ts` is needed. |

What this means for the plan:

- The plan says "the deploy restarts them, but a rotation between deploys could leave running tasks with a stale password". With a 7-day rotation this will happen in practice. Established connections survive a password change. New connections (pool replacement after idle error, scaling out, restarts of one task) use whichever value that task started with, so tasks that started before the rotation fail to reconnect.
- AWS's documented remedy is a new deployment. AWS's general advice for applications is to retrieve the secret at runtime (rds-secrets-manager page: "RDS rotates database credentials regularly, without requiring application changes" applies to clients that fetch the secret). That would need `secretsmanager:GetSecretValue` on the app task role, which conflicts with "no permissions".
- Options, in order of effort for development: (a) turn rotation off for the managed secret with `aws_secretsmanager_secret_rotation` and `rotation_enabled = false` (the provider docs describe this); (b) trigger a forced deployment after each rotation; (c) fetch at runtime. The plan should pick one and say so.

## 2. `aws_ecs_express_gateway_service`

**Verdict: Feasible with changes.**

Arguments (**Verified**, https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/ecs_express_gateway_service.html.markdown):

- Required: `execution_role_arn`, `infrastructure_role_arn` (forces replacement if changed).
- Optional: `cluster` (default `default`), `cpu` (power of 2, 256 to 4096), `memory` (512 to 8192), `health_check_path` (default `/`), `network_configuration` (`subnets`, `security_groups`; "specify at least two" subnets), `primary_container` (`image` required, `container_port` default 80, `environment`, `secret` with `name` and `value_from`, `aws_logs_configuration`), `scaling_target` (`min_task_count`, `max_task_count`, `auto_scaling_metric`, `auto_scaling_target_value`), `task_role_arn`, `wait_for_steady_state` (default false), `service_name`, `cpu_architecture`.
- Exports `service_arn`, `service_revision_arn`, `ingress_paths[].endpoint`, `current_deployment` (deprecated). No load balancer attribute.
- Delete race: add `depends_on` for the IAM policy attachments. The plan does this.
- Updates deploy as a canary, zero downtime.

| Question | Finding |
|---|---|
| Minimum provider version | **Verified.** New resource in 6.23.0 (2025-11-26), https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/CHANGELOG.md. Fixes that matter here landed in 6.50.0 (2026-06-10): an "inconsistent result after apply" error on `network_configuration[0].security_groups`, which the plan sets, and a "Resource Already Exists" error on recreate. The 6.50.0 fix also requires `ec2:DescribeSecurityGroups` for the principal running Terraform. `bootstrap/versions.tf` uses `~> 6.0` and the lock file is 6.74.0. Set `>= 6.50` in `environments/development` and `modules/hub`. |
| `ignore_changes` on the image | **Partly verified.** Terraform core supports `ignore_changes` on nested attributes. Source shows Update expands the whole plan into the request, and Read fills `primary_container` from `ActiveConfigurations[0]`, so state holds the running image and an ignored image keeps the running value on unrelated updates. I could not confirm whether `primary_container` is a list block (`primary_container[0].image`) or a single nested attribute (`primary_container.image`). The `network_configuration` schema is a single nested object attribute. Check with `terraform validate` first. Also note ECS "resolves image tags to digest IDs" (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html), so the image in state may differ from the configured string, which is another reason the ignore is needed. |
| Partial `primaryContainer` merge | **Not documented.** `UpdateExpressGatewayService` lists every field as optional but `image` is required in `ExpressGatewayContainer`, so a partial container must at least include the image: https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_UpdateExpressGatewayService.html. Sending the full current container is the safe choice and the plan does it. `describe-express-gateway-service` returns `activeConfigurations` as a list. During a canary there may be more than one, and the docs do not say which is current. Take the container from the one whose `serviceRevisionArn` matches the latest, or read it from Terraform outputs. (**Unverified** ordering.) |
| Load balancer with public subnets | **Verified.** Custom public subnets give an internet-facing ALB and `assignPublicIp` on tasks. Private subnets give an internal ALB. The first Express service in a VPC fixes the load balancer subnets, up to 25 services share one ALB. Listener is HTTPS 443 with an ACM certificate. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html |
| Security groups | **Partly verified, important gap.** The same page says: "If none are provided, Express Mode creates both a Service Security Group and a Load Balancer Security Group", the service group "allows outbound traffic to the public internet", and "When you provide a security group you are providing an additional ingress path to your service." Evidence on what Express still creates when you supply one is missing. The infrastructure role can only change security groups tagged `AmazonECSManaged=true` (https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonECSInfrastructureRoleforExpressGatewayServices.html), so it cannot add an ingress rule to your untagged task group. **Inferred:** Express still creates its own tagged service and load balancer groups, your group is added to the tasks, and security groups are additive, so the plan's "outbound 443 and 5432 only" has no effect while the Express service group allows all outbound. AWS's own route to restrict that is to edit the Express-created group's egress after creation (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-best-practices.html). The plan's description "added alongside" is an inference and the first apply must confirm it. Also confirm that the load balancer can reach tasks on port 3000 (target health). |
| Load balancer ARN from Terraform | **Not an attribute.** The resource exports none (above). The describe API description mentions "managed AWS resource status including load balancers" but the response syntax has no load balancer field (https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeExpressGatewayService.html). Supported alternative: the `aws_lb` data source accepts `tags` ("each pair of which must exactly match"): https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/d/lb.html.markdown. **Inferred:** Express load balancers carry `AmazonECSManaged=true`, because the infrastructure role policy only allows ELB changes on resources with that tag. The exact tag set on the ALB is **unverified**. One Express ALB per VPC makes the match unique in a one-VPC development account, but the data source errors on zero or several matches (**unverified** behaviour). Put `depends_on = [aws_ecs_express_gateway_service.hub]` on the data source so it reads during apply, and the manual `alb_arn` step disappears. Bonus: the association then follows the ALB if Express replaces it. The AWS-documented manual route is `aws wafv2 associate-web-acl --resource-arn <alb>` (best-practices page above). |

Other facts:

- Express creates its own log group that "never expires" if you do not give one (best-practices page). The plan creates log groups with retention, which is right.
- Updates are canary: 5 percent of traffic, 3 minute bake, rollback alarm on the 4xx and 5xx rate (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-update-full.html). This reinforces the need for backward-compatible schema changes.
- If you use Express's API to change the primary container, Express makes a new managed task definition (same page).

## 3. RDS PostgreSQL 18 and TLS

**Verdict: Feasible with changes.**

| Question | Finding |
|---|---|
| PostgreSQL 18 on RDS | **Verified (region-agnostic).** The release notes list 18.1 (first GA) through 18.6 (latest on the page), plus revision builds 18.3-R2 and 18.4-R2. https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html. Only the first 100,000 of 302,892 characters were read, which covers the 18.x section at the top. |
| Available in `eu-west-2` | **Unverified.** The pages do not give per-region availability. The documented check is `aws rds describe-db-engine-versions --engine postgres --engine-version 18 --region eu-west-2` (https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_UpgradeDBInstance.PostgreSQL.html). The developer should run it before writing the module. I did not run it. |
| `rds.force_ssl` | **Verified.** Exists. Default is 1 for PostgreSQL 15 and later, 0 for 14 and older. Changing it needs a custom parameter group. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html. So on 18 it is already on. Setting it explicitly is harmless and documents intent. The parameter group family name for 18 is **inferred** as `postgres18` from the documented `postgres13` pattern. Confirm with `describe-db-engine-versions`. |
| `verify-full` with the global bundle | **Correct.** The server certificate includes the instance endpoint as the common name when verification is on, so `DATABASE_HOST` must be the endpoint name (same SSL page). The AWS file is named `global-bundle.pem`, downloaded from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`. The plan's name `rds-global-bundle.pem` is only the local copy name. A region bundle for London exists at `https://truststore.pki.rds.amazonaws.com/eu-west-2/eu-west-2-bundle.pem`. AWS says to register only root CAs, which both bundles contain, and gives no preference. A region bundle trusts fewer roots. https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html |
| How `pg` treats `sslmode=verify-full` | **Verified in the installed code.** `pg` 8.23.1 with `pg-connection-string` 2.14.1: by default `verify-full` changes nothing beyond making `ssl` an object, and certificate and hostname checks stay on (https://raw.githubusercontent.com/brianc/node-postgres/master/packages/pg-connection-string/index.js, and `node_modules/pg-connection-string/index.js` lines 134 to 153). `sslrootcert=<file>` reads the file into `ssl.ca`. `src/db/client.ts` passes only `connectionString`, so nothing overrides it. The node-postgres docs warn that `sslmode` in the URL replaces any `ssl` object (https://github.com/brianc/node-postgres/blob/master/docs/pages/features/ssl.mdx). |
| `NODE_EXTRA_CA_CERTS` | **Verified, works.** It adds the file's certificates to the built-in roots, is read only at process start, a missing or malformed file gives one warning and is otherwise ignored, and it is not used when a `ca` option is set. https://nodejs.org/api/cli.html. A failed read is silent apart from a warning, so a bad path shows up as a connection failure under `verify-full`, not at start-up. |
| Which to use | **Recommendation (inferred from the above).** Put `sslrootcert=/app/certs/rds-global-bundle.pem` in the URL that `src/config.ts` builds. It trusts only the RDS roots for the database connection, fails loudly if the file is missing (`readFileSync` throws), and does not depend on an environment variable surviving into the process. `NODE_EXTRA_CA_CERTS` also works and widens trust for every outbound TLS call in the process. |

## 4. GitHub OIDC

**Verdict: Feasible with changes.**

| Question | Finding |
|---|---|
| `sub` for an environment-scoped job | **Verified.** `repo:ORG/REPO:environment:ENVIRONMENT-NAME`. Colons in a name become `%3A`. https://docs.github.com/en/actions/reference/security/oidc and https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws |
| Immutable `sub` | **Verified, and not in the plan.** Repositories created after 2026-07-15 use `repo:OWNER@OWNER-ID/REPO@REPO-ID:...`. Older repositories keep the old form unless they opt in. Renames and transfers after that date also switch. "You can't remove these IDs from the immutable format." The docs give no environment-scoped example of the immutable form. Check which form `alphagov/gds-hub` uses (repository settings, OIDC) before writing the trust policy, and note a rename or transfer would break it. https://docs.github.com/en/actions/reference/security/oidc |
| `aud` | **Verified.** `sts.amazonaws.com` for the official action. The job needs `permissions: id-token: write` and the environment must be named in the job. |
| Thumbprint | **Verified, not needed.** AWS uses its trusted root CA library and falls back to thumbprints only if the identity provider's certificate is not signed by one of them. https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html. The provider resource's `thumbprint_list` is optional and, for GitHub, "retained in the configuration but not used" (https://raw.githubusercontent.com/hashicorp/terraform-provider-aws/main/website/docs/r/iam_openid_connect_provider.html.markdown). The committed `bootstrap/main.tf` omits it, which is correct. |
| Action | **Verified.** `aws-actions/configure-aws-credentials` current release is v6.3.0, floating `v6`. Docs say to use `id-token: write`, `role-to-assume`, scope the `sub` condition, avoid `ForAllValues:` in Allow statements, and grant only what the workflow needs. https://github.com/aws-actions/configure-aws-credentials. The plan's SHA pin is better than the floating tag. |
| Environment protection | **Verified.** The GitHub page recommends protection rules on environments. The plan's "deploys limited to `main`" does this. |
| Hub module inputs | `github_oidc_provider_arn` and `github_repository` are enough. A `data "aws_iam_openid_connect_provider"` lookup by URL would avoid passing the ARN. Either is fine. |

Least privilege for the deploy role:

| Need | Actions and scope | Source |
|---|---|---|
| ECR push | `ecr:GetAuthorizationToken` on `*`. On the one repository ARN: `ecr:CompleteLayerUpload`, `UploadLayerPart`, `InitiateLayerUpload`, `BatchCheckLayerAvailability`, `PutImage`, `BatchGetImage`. | **Verified**, https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html |
| Register the migration task definition | `ecs:RegisterTaskDefinition`. The authorisation reference lists resource type `task-definition*`, so it can be scoped to the family. The `family:*` wildcard form is **unverified**. The plan scopes `RunTask` but does not say how `RegisterTaskDefinition` is scoped. Exclude the data migration family. | https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonelasticcontainerservice.html |
| Describe task definitions | `ecs:DescribeTaskDefinition` has no resource types listed, so it needs `*`. | same page |
| Run and read the migration | `ecs:RunTask` on `task-definition/hub-<env>-schema-migration:*`, condition `ecs:cluster`. `ecs:DescribeTasks`. | same page |
| Update the Express service | `ecs:UpdateExpressGatewayService`, `ecs:DescribeExpressGatewayService` on the service. The plan also needs `ecs:DescribeServices` if the workflow waits with `aws ecs wait services-stable`. Express update lists `ecs:RegisterTaskDefinition` as a dependent action. | same page |
| Pass roles | `iam:PassRole` on the execution role and app task role only, with `iam:PassedToService = ecs-tasks.amazonaws.com`. The page lists `ecs.amazonaws.com` as well for the Express actions. The Update request has no infrastructure role parameter, so the infrastructure role is probably not needed (**unverified**). Add it only if the first deploy gives `AccessDenied`. Never include the data migration task role. | same page |
| Logs | `logs:GetLogEvents` on the schema migration log group. | plan |

## 5. Terraform and state

**Verdict: Feasible with changes.**

| Question | Finding |
|---|---|
| Version for `use_lockfile` | **Verified.** v1.10.0 (2024-11-27) added S3 native locking. v1.11.0 (2025-02-27): "S3 native state locking is now generally available" and DynamoDB arguments deprecated. 1.10.1 fixed lock files on buckets with object lock. https://raw.githubusercontent.com/hashicorp/terraform/v1.10/CHANGELOG.md and https://raw.githubusercontent.com/hashicorp/terraform/v1.11/CHANGELOG.md. The backend docs state no minimum version. They require `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on the lock file and recommend bucket versioning. https://developer.hashicorp.com/terraform/language/backend/s3. The plan and `bootstrap/versions.tf` say `>= 1.10`. Use `>= 1.11` so you are on the GA feature. |
| `prevent_destroy` on the state bucket | **Sound.** Terraform rejects plans that destroy the object. Caveats: removing the block lets Terraform destroy it, and it also stops `terraform destroy` for the whole stack. https://developer.hashicorp.com/terraform/language/meta-arguments/lifecycle. The committed comment ("Remove this block on purpose to tear it down") matches. Versioning plus 90-day noncurrent expiry (already in `main.tf`) covers accidental overwrites. |
| Bootstrap state in the bucket it creates | **Sound and common, with a cost.** Every stack's state, including the bootstrap, then depends on one bucket. Losing it loses all of them. Destroying the bootstrap later needs the state moved back to local first. Both are acceptable for development. Keep a note in `bootstrap/README.md`. |
| Bucket name through `-backend-config` | **Works, but does not hide the name.** HashiCorp: values passed with `-backend-config` or hard-coded end up "in both the `.terraform` subdirectory and in plan files". Shell history keeps command-line flags. https://developer.hashicorp.com/terraform/language/backend. A bucket name is not a secret, so this is fine. Say in the runbook that the aim is to keep the name out of git, not out of local files. Use a git-ignored `backend.hcl` file (`-backend-config=backend.hcl`) rather than a flag, so it is not in shell history and is repeatable. Never pass credentials this way. |
| `.terraform/` and `terraform.tfvars` | Both are present under `infrastructure/terraform/bootstrap/`. Confirm they are in `.gitignore` before the first commit (the working tree shows only `.gitignore` as modified, so check its diff). |

## 6. Security posture

**Verdict: Feasible with changes. Acceptable for development only, with the items below.**

| Risk | Best practice or development only | Mitigation |
|---|---|---|
| Public ALB with a WAF IP allow-list as the only gate. **Inferred:** the Express load balancer group allows HTTPS inbound from the internet (docs say "inbound traffic for HTTPS resolution"). | Development only. Express's own best practice is private subnets and an internal ALB for sensitive apps, plus WAF. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-best-practices.html | Already in the backlog (CloudFront and Lambda@Edge, internal ALB). Add: WAF logging, run the web ACL rules in count mode first as AWS advises (https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-associating-aws-resource.html), keep the rate limit. |
| Window between service creation and WAF association. The Express URL is a public DNS name. Also repeats if Express replaces the ALB. | Development only, and only because the data is synthetic. | Use the tag-based data source with `depends_on` (section 2) so the association is in the same apply. Do not load data until you have confirmed a 403 from a non-allowed address. Say so in the runbook order. WAF propagation time is **unverified**. |
| Tasks have public IPs in public subnets. | Development only. | Confirm after the first apply that no task group allows inbound from `0.0.0.0/0` on port 3000. AWS says Express creates "minimal required ingress" but the exact rules are not listed. |
| Egress restriction on the task group is not effective (section 2). | Gap in the plan's claim, not an accepted risk. | Either drop the claim, or edit the Express-created service group's egress after creation as AWS's best-practices page describes. That edit is outside Terraform and Express "will not overwrite changes unless requested" (https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-advanced-customization.html). |
| Master user used by the app and both migration tasks. | Development only. Already in the backlog. | Least-privilege role for the app before any real data. |
| Credentials as environment variables. | Standard ECS pattern, with a known exposure: "applications … container logs and debugging tools have access to the environment variables" (secrets-envvar page). | Never log `process.env`. The plan already keeps errors free of the password. |
| Stale credentials after rotation (section 1). | Reliability risk. | Choose one of the three options in section 1. |
| Deploy role can register and run a task with the app role, so a workflow change could run code with database credentials. | Inherent to running migrations from CI. | Keep `environment: development` with required reviewers or a branch policy, scope `RegisterTaskDefinition` to the one family, `PassRole` with the `PassedToService` condition, and exclude the data migration role. Trust policy must use `StringEquals` on `sub`. |
| RDS | Reasonable for development. | Add `deletion_protection` for production, enable log exports to CloudWatch, and keep the encrypted storage, private subnets, 7-day backups and final snapshot already planned. VPC flow logs are in the backlog and AWS recommends them (best-practices page). |
| ECR immutable tags and scan on push | Best practice. | Keep. Express resolves tags to digests ("versionConsistency: enabled"). |
| State bucket | Best practice for development. | SSE-S3 is fine here. Consider SSE-KMS for production. |

## 7. Errors, gaps and ordering in the plan

1. **The two-stage first apply cannot work as written (defect).** Stage 1 uses `-target` for ECR and the deploy role, then runs `deploy-development` to push the first image. That workflow also registers and runs the schema migration (needs the RDS instance, secret, task definition and security groups, none in the target set) and then describes and updates the Express service (which does not exist yet). It would fail at step 2. The service cannot be created without an image in ECR, and the migration cannot run without the database. `-target` is documented as "exceptional circumstances only" and "not recommended for routine operations" (https://developer.hashicorp.com/terraform/cli/commands/plan). Replace it with a `create_service` variable (default false). Apply 1 builds everything except the service and the WAF association. Run the workflow in a mode that pushes the image and runs the schema migration only. Apply 2 sets `create_service = true` and `app_image` to the pushed digest. The workflow's "update the service" step is skipped when the service does not exist, or its first run is a manual developer push.
2. **Secrets rotation leaves tasks stale** (section 1). No remedy in the plan.
3. **Task group egress limit has no effect** (section 2). **Inferred**, confirm on first apply.
4. **No NAT and no VPC endpoints** means every one-off task (`run-task`) needs `assignPublicIp=ENABLED` and public subnets to reach ECR, Secrets Manager, CloudWatch Logs and S3. The workflow and runbook commands do not say so. Express does this for the service itself ("enabled for public subnets") but `run-task` does not get it automatically. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html (service behaviour). The one-off task behaviour is **inferred** from there being no NAT.
5. **Provider constraint** should be `>= 6.50` (section 2). The Terraform principal needs `ec2:DescribeSecurityGroups`.
6. **`alb_arn` manual step** can be replaced by the tag lookup (section 2).
7. **Deploy role gaps**: `ecs:DescribeServices` if waiting, `ecs:DescribeTaskDefinition` on `*`, `RegisterTaskDefinition` scope, `PassRole` condition (section 4). The plan's `PassRole` scope (execution and task roles only) is the right direction.
8. **Immutable OIDC `sub`** may apply (section 4).
9. **Cluster**: the plan does not set `cluster`, so Express uses the `default` cluster, shared with anything else in the account. Create an `aws_ecs_cluster` per environment and pass it as `cluster`, so `RunTask` can be limited with the `ecs:cluster` condition key. The cluster can only be set on create (`express-service-work` page). Recommended, not required.
10. **Who owns the migration task definition image.** Terraform creates `hub-<env>-schema-migration` and the workflow also registers new revisions of it. That works (the workflow always registers its own revision), but Terraform's copy carries a placeholder image. Say so in the module so nobody runs the Terraform revision by hand.
11. **Immutable ECR tags** (**unverified**, not read in this pass): pushing the `sha` tag twice, for example re-running after a failed later step, would be rejected by an immutable repository. Check for the tag first or add the run number to the tag.
12. **`activeConfigurations[0]`** in the image-swap step may not be the current configuration during a canary (section 2). **Unverified** ordering.
13. **Terraform version** `>= 1.11` (section 5).
14. **Order check on rotation vs deploy**: schema migration before the service update is right. Keep it, and keep migrations backward compatible, because the canary runs old and new tasks together (update page).

## Changes to make to the plan

1. Replace the `-target` two-stage first apply with a `create_service` variable. Define a "push image and migrate only" workflow mode for the first run. Set the service and the WAF association in the second apply.
2. Decide how rotated database passwords reach running tasks: turn rotation off for development, force a deployment after each rotation, or read the secret at runtime. Remove the sentence saying the RDS secret has only two keys, or check it with `get-secret-value`.
3. Pin the AWS provider to `>= 6.50` and Terraform to `>= 1.11` in `modules/hub`, `environments/development` and `bootstrap`. Give the Terraform principal `ec2:DescribeSecurityGroups`.
4. Find the load balancer with `data "aws_lb"` using the `AmazonECSManaged=true` tag, with `depends_on` the Express service, and associate the WAF in the same apply. Drop the `alb_arn` variable. Check the exact tags on the first apply.
5. Treat the task security group as additive. Remove the claim that outbound is limited to 443 and 5432, or edit the Express-created group's egress after the first apply and record that it is outside Terraform. Verify the ALB can reach port 3000 and that no group opens 3000 to the internet.
6. Add `assignPublicIp=ENABLED` and the public subnet IDs to every `run-task` command in the workflow and runbook.
7. Change the database URL build to include `sslrootcert=/app/certs/rds-global-bundle.pem` (or keep `NODE_EXTRA_CA_CERTS` and accept the wider trust). Download from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem` or the `eu-west-2` bundle.
8. Run `aws rds describe-db-engine-versions --engine postgres --engine-version 18 --region eu-west-2` and record the 18.x version and parameter group family in the module.
9. Check whether `alphagov/gds-hub` uses the immutable `sub` format and write the trust policy to match. Add `StringEquals` on `aud` and `sub`.
10. Complete the deploy role: `ecs:DescribeServices` (if waiting), `ecs:DescribeTaskDefinition` on `*`, `RegisterTaskDefinition` scoped to the schema migration family only, `iam:PassRole` limited to the execution and app task roles with `iam:PassedToService = ecs-tasks.amazonaws.com`. Add the infrastructure role only if the first deploy needs it.
11. Create a per-environment `aws_ecs_cluster` and set `cluster` on the Express service.
12. Make ECR tag handling safe for re-runs (check before push, or include the run number).
13. Confirm `.terraform/` and `terraform.tfvars` are git-ignored. Use a git-ignored `backend.hcl` for the bucket name and say in the runbook that the aim is keeping it out of git, not secrecy.
14. Add to the runbook: do not load data until a 403 has been seen from a non-allowed IP.
15. Test early that Express accepts `<arn>:username::` in `secret.value_from` and that `primary_container[0].image` is the correct `ignore_changes` path (`terraform validate`).

## Unverified claims

- RDS-managed secret contains only `username` and `password`. No AWS page lists its keys.
- Express Mode accepts the `<arn>:username::` JSON-key form in `valueFrom`. Documented for ECS task definitions only.
- PostgreSQL 18 (and which 18.x) is offered in `eu-west-2`. Versions are documented, regions are not. Needs `describe-db-engine-versions`.
- Parameter group family name `postgres18` (pattern from `postgres13` in an AWS example).
- Whether Express still creates its own service and load balancer security groups when you supply yours, and the exact ingress and egress rules (only partly described on https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html). Several Express pages (`express-service-networking`, `express-service-parameters`, `express-service-managed-resources`, `express-service-work-with`) returned no content and were not used.
- Which tags the Express load balancer carries. `AmazonECSManaged=true` is inferred from the infrastructure role policy.
- `aws_lb` data source behaviour when there are zero or several matches, and with `depends_on` on a resource not yet created.
- Whether `primary_container` is a list block or a single nested attribute in the Terraform schema (affects the `ignore_changes` path).
- Whether `ARNType` in the provider accepts a suffixed Secrets Manager ARN.
- Ordering of `activeConfigurations` during a canary.
- Whether `UpdateExpressGatewayService` needs `iam:PassRole` on the infrastructure role, and whether `RegisterTaskDefinition` can be scoped with a `family:*` pattern before a revision exists.
- WAF association propagation time.
- ECR immutable tag rejection on re-push (not checked in this pass).
- Whether `alphagov/gds-hub` is on the immutable OIDC `sub` format.
- Rotation behaviour of tasks after a password change (that new connections fail with the old password) is reasoning from the ECS docs, not stated by AWS.
