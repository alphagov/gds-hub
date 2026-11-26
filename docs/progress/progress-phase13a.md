# Phase 13a: Running the app on AWS (Part 1)

**Status:** code and documentation complete on 2026-11-26. Lint, typecheck, Vitest, Playwright (in the sandbox) and `check:no-migration-data` were run; see [Checks](#checks). The Docker build, Terraform checks and AWS steps could not run in the sandbox and are in [Needs the developer](#needs-the-developer).

## What was built

- **Terraform (Part 1)** in `infrastructure/terraform/`: network, RDS PostgreSQL 18 with a managed master secret, ECR, log groups, IAM, WAF, the Express Mode service (created only when `create_service` is true) and the schema and data migration task definitions. Tasks run on ARM64 through the service module's `cpu_architecture` variable (default `ARM64`).
- **Database settings:** `src/config.ts` builds `databaseUrl` from `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER` and `DATABASE_PASSWORD`, URL-encoded, with `sslmode=verify-full`.
- **Image:** the Dockerfile downloads the RDS CA bundle with a pinned SHA-256, sets `NODE_EXTRA_CA_CERTS` and copies `drizzle/`.
- **`TRUST_PROXY_HOPS`:** an optional whole number from 0 (default 0). `createApp` applies it with `app.set("trust proxy", n)`. Terraform passes `1` for the load balancer. Documented in the README configuration table.

## Key files

- `src/config.ts`, `src/app.ts`, `test/unit/config.test.ts`, `test/unit/app.test.ts`, `test/unit/helpers.ts`
- `Dockerfile`
- `infrastructure/terraform/` (`bootstrap/`, `environments/development/`, `modules/`)

## Decisions

- **A hop count, not `true`.** With `true`, Express trusts every `X-Forwarded-For` entry and a client can pick its own `req.ip`. A number trusts only that many proxies from the app side. The default is 0, so local runs and tests trust no forwarded header.
- **`trustProxyHops` is a required field of `Config`**, so `testConfig` in `test/unit/helpers.ts` gained it.
- **Nothing in `src` reads `req.ip`, `req.ips` or an `X-Forwarded-*` header yet.** The request logger and the audit actor don't use the client address, so no existing behaviour changes. When something does (rate limiting, audit entries with an address), it gets the right address from `req.ip`.
- **No runbook file yet.** The manual steps are below. Part 2 adds `docs/deployment.md`, with the deploy workflow.

## Blockers

None in code. The first-apply checks decide whether Express Mode accepts `<secret-arn>:username::` and whether the load balancer tags let the WAF lookup work.

## Needs the developer

Cannot run in the sandbox (no Docker, Terraform or AWS CLI):

- `docker build --platform linux/arm64 --build-arg APP_VERSION=<sha> .`, including the pinned CA bundle download.
- `terraform fmt -check`, `terraform validate` and `terraform plan` in `bootstrap/` and `environments/development/`, then both applies.
- The first deploy, in this order (read values with `terraform output -raw <name>` into shell variables and never print them):
  1. Build the image for `linux/arm64` with `APP_VERSION` set to the short commit hash, and push it to ECR. ECR tags are immutable, so each build needs a new tag. Note the image digest.
  2. Register a new revision of the schema migration task definition with the digest, then run it with `run-task` on the public subnets with `assignPublicIp` enabled. The exit code must be 0 and the log must show the migrations applied.
  3. Check the RDS secret has `username` and `password` keys, PostgreSQL 18 is offered in the region, and secret rotation is off.
  4. Set `create_service = true` and `app_image = "<ECR URL>@sha256:<digest>"` in `terraform.tfvars`, then plan and apply. Expect the Express service and the WAF association to be added.
  5. Check `/health` through the service URL from an allowed address, that no security group Express created allows `0.0.0.0/0` inbound on port 3000, that the WAF is associated, and that the logs show a database connection with no certificate errors.
  6. If the image build fails the CA bundle checksum, AWS has rotated the bundle: download the new one, check its certificates and update the hash in the `Dockerfile`.
- Recording the answers to the first-apply checks (secret keys, PostgreSQL 18, secret form, security groups, load balancer tags) here.
- Checking the `terraform.tfvars` and plan output for identifiers before sharing anything.

## Follow-ups

Logged in `docs/backlog.md`. The `trust proxy` item was removed because this phase does it.

## Checks

Run in the sandbox on 2026-11-26, against a local database freshly migrated and seeded with the synthetic data:

| Check                             | Result                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                    | ESLint passes. Prettier warns about `docs/research/infrastructure-plan-feasibility.md` and `research-findings.md`, which this phase didn't change. |
| `npm run typecheck`               | Passes.                                                                                                                                            |
| `npm test`                        | 52 files and 894 tests pass.                                                                                                                       |
| `npm run test:e2e`                | 130 pass, 3 are skipped and none fail.                                                                                                             |
| `npm run check:no-migration-data` | Passes.                                                                                                                                            |

An earlier e2e run failed 45 tests because the local database held imported data instead of the seed. The failures went away once the database was reset and seeded again, so they were not caused by this phase.
