# Progress log

A short summary of each completed phase. The full handover for each phase (what was built, key files, decisions, blockers and follow-ups) is in its own file, `docs/progress/progress-phase<N>.md`.

| Phase | Name                        | Date       | Status                     | Handover                                                                    |
| ----- | --------------------------- | ---------- | -------------------------- | --------------------------------------------------------------------------- |
| P0    | Foundations and tooling     | 2026-11-04 | Code complete              | [progress-phase0.md](progress-phase0.md)                                    |
| P1    | GOV.UK shell and SSR        | 2026-11-09 | Code complete              | [progress-phase1.md](progress-phase1.md)                                    |
| P2    | Schema, migrations and seed | 2026-11-10 | Code complete, not yet run | [progress-phase2.md](progress-phase2.md)                                    |
| P3    | Repositories and audit      | 2026-11-11 | Code complete              | [progress-phase3.md](progress-phase3.md)                                    |
| P4    | Read journeys               | 2026-11-11 | Code complete              | [progress-phase4.md](progress-phase4.md)                                    |
| P5a   | Migration: inventory        | 2026-11-11 | Code complete              | [progress-phase5.md](progress-phase5.md)                                    |
| P5b   | Migration: load and verify  | 2026-11-12 | Code complete              | [progress-phase5.md](progress-phase5.md#part-b-loader-redirects-and-verify) |

## Phase 0: Foundations and tooling (2026-11-04)

- Express 5 and TypeScript (strict, ESM) skeleton with an app factory, Zod-validated config, a structured JSON logger behind a `Logger` interface, request IDs and `GET /health`.
- Vitest unit tests and a Playwright test for `/health`.
- Multi-stage Dockerfile on `node:24-alpine` and `docker-compose.yml` with `app` and `postgres:18-alpine`.
- **Not verified in the sandbox:** Vitest, the Docker image build and `docker compose up` (missing Linux native binaries and Docker images). The developer validates these on the host.
- **Missing packages:** `@types/compression`, plus the Linux `@esbuild` and `@rolldown` native bindings.
- **Key follow-ups:** add `npm run check:no-migration-data` (and add it to the test workflow), choose a logging library, set `trust proxy` in Phase 13.
- **Pull request testing (added 2026-11-06):** `.github/workflows/test.yml` runs lint and typecheck, Vitest and Playwright on every pull request, with Node from `engines.node` and the `postgres:18-alpine` service. The developer marks the three jobs as required checks in branch protection. See [progress-phase0.md](progress-phase0.md#pull-request-testing).
- **Security hardening (2026-11-06):** actions pinned to SHAs, `persist-credentials: false`, `npm ci --ignore-scripts`, Dependabot for actions, npm and Docker images. JWT verification is now a rule for Phase 8. Docker images pinned by digest. Outstanding: apply the repository settings, and change `@types/node` to `^24`.

## Phase 1: GOV.UK shell and server-side rendering (2026-11-09)

- GOV.UK Frontend 6.6 with Nunjucks server-side rendering (autoescape on). `layouts/base.njk` extends `govuk/template.njk` with the header, service navigation, a "Beta" phase banner, breadcrumbs and the footer. `content.njk` and `listing.njk` add overridable blocks.
- A typed render helper pairs each template with its view model. Section names, routes, asset URLs and error titles come from one place, `src/site-map.ts`, which the app and the tests share.
- Placeholder home and section pages. GOV.UK 403, 404 and 500 pages come from one central error handler. Unknown routes now get the HTML 404 page instead of JSON.
- A Content-Security-Policy with a per-request nonce for GOV.UK's inline script.
- Playwright runs everything with JavaScript on and off. axe (WCAG 2.2 AA tags) scans every route.
- **Verified on the host:** the sandbox has no Node.js, so the developer ran lint, typecheck, Vitest and Playwright on the host; all pass. See [progress-phase1.md](progress-phase1.md) for the layout blocks, view-model convention and how to add a route.

## Phase 2: Schema, migrations and seed (2026-11-10)

- Drizzle ORM schema in `src/db/schema/`, following the Section 6 data model and the developer's prototype schema, and checked against the current Hub's YAML structure (all inputs are in the git-ignored `db-reference-material/`). There are 16 tables:
  - **Catalogue:** `vendors`, `suppliers`, `tools`, `supplier_tools`, `contracts`, `ownership_levels`, `instances`, `capabilities`, `capability_tools`
  - **Organisation:** `product_team_services`, `product_team_service_instances`, `instance_capabilities`, `business_units`, `business_unit_product_team_services`
  - **Content and audit:** `pages`, `audit_log`
- No `admin_users`, `roles`, `active_admin_comments` or `versions`, and no credential columns (a test checks this).
- Five pg enums: `migration_status`, `engineering_or_business_tool`, `page_type`, `content_status` and `audit_action`.
- `bigint` identity keys throughout. `instances.target_ownership_level_id` and `business_units.parent_id` are now real `bigint` foreign keys.
- Section 6 additions: slugs on vendors and teams, `last_reviewed_at` (set by a person) alongside `updated_at`, flat `pages` with a globally unique slug, linked to a team, and `audit_log` with `before`, `after`, `changed_fields`, `actor_name` and `actor_subject`. `page_type` adds `whats_new` to Section 6's four values.
- `tools.vendor_id` and `instances.contract_id` are nullable. `instances.tool_id` was added, with a composite FK so that an instance's contract is always for the same tool.
- Hand-written `drizzle/0001_search.sql`: generated, weighted `search_vector` columns (A = title or name, B = summary or description, C = body) and GIN indexes on 8 tables (Section 6.4's six plus business units and ownership levels), plus the `search_index` UNION ALL view with `slug` and `snippet_source` (published pages only).
- `db:generate`, `db:migrate`, `db:seed` and `db:reset`. The seed is synthetic only and audited. Reset and seed only run against local databases, and reset also refuses any database holding imported data or data the seed didn't create.
- `audit_log` is append-only (triggers in the hand-written `drizzle/0002_audit_log_append_only.sql`). Link columns must be `http` or `https` URLs, GitHub organisation names must be valid, and extra instance attributes must be text.
- Vitest integration tests (in `npm test`) create a throwaway database, migrate and seed it, and check foreign keys, RESTRICT and CASCADE, check constraints, the absence of credential columns and search ranking. CI now fails if the migrations are out of date with the schema.
- **Not run in the sandbox** (no Node.js or Postgres). The developer generates `0000_init.sql` and runs the checks on the host. See [progress-phase2.md](progress-phase2.md#steps-to-run-on-the-host).
- **Open questions for Phase 5:** contracts need a supplier but the YAML has none; map the real migration status values; decide the primary business unit for teams in more than one unit.

## Phase 3: Repositories and audit service (2026-11-11)

- One typed data-access layer in `src/repositories`. `createRepository(table, entityType)` gives every data table `list`, `getById`, `getBySlug` (slug, or key where there's no slug), `create`, `update` and `remove`. `createRepositories(db)` binds them all, and its `transaction()` method groups several writes into one transaction.
- **Every write is audited in the same transaction.** The repository locks and reads the record as it was before, makes the change, sets `updated_at`, works out the changed fields and adds an `audit_log` entry. If the audit entry fails, the change is rolled back. An update that changes nothing writes nothing. Join-table rows the database would delete with a record are removed and audited first, and changes are dated by when they were made (not when their transaction started).
- `Actor` is `{ email, requestId? }`. `createActor` builds it from the editor's email (from the verified Lambda@Edge JWT, Phase 8), and `systemActor("data_migration")` gives `system:data_migration` for the migration. The email is stored as `actor_name` and `actor_subject`. `before` and `after` use camelCase field names.
- The audit service (`src/services/audit`) has `historyFor`, `recentChanges` and `lastUpdated`. The `ToolDetail` and `InstanceDetail` read models include contracts, suppliers, capabilities, ownership levels, and teams with their business units.
- `RepositoryError` reports failures by kind (`not_found`, `duplicate`, `in_use`, `invalid_reference`, `invalid_value`, `failed`), without the values involved.
- A lint rule stops anything outside `src/repositories` and `src/db` using the database.
- `audit_log.source_ip` was dropped (developer's decision). Nothing was deployed, so the migrations were squashed into a fresh baseline: `0000_init` (generated) plus the hand-written `0001_search` and `0002_audit_log_append_only`. Rebuild local databases with `npm run db:reset`. From now on migrations are append-only.
- **Written without running anything in the sandbox.** The developer ran lint, typecheck and the tests on the host, and they pass. See [progress-phase3.md](progress-phase3.md#steps-to-run-on-the-host).

## Phase 4: Read journeys (2026-11-11)

- Read-only pages: home (capability groups), `/capabilities` and `/capabilities/:key`, `/tools` and `/tools/:slug`, `/instances/:slug`, `/vendors/:slug`, `/services` and `/services/:slug`, and `/business-units/:key`. They are built by routes, then the catalogue service, then the repositories. Presenters turn read models into typed view models, and templates only loop and test conditions.
- The tool page shows each instance with a `govukDetails` for Getting access, Authentication, User provisioning and Escalation contact. A `govukTag` shows its migration to DSIT identity. Access instructions are 3 clicks from the home page.
- Breadcrumbs on every page except home. The service navigation marks the page's section, including on instance, vendor and business unit pages.
- A left-hand contents on every page except error pages: capability groups and capabilities in weight order, without hidden ones (developer's decision). It's always shown on desktop, and opens and closes in a `govukDetails` on small screens, without JavaScript.
- New read models for capabilities, products, teams and services, business units, vendors and the services directory. Weights are respected throughout.
- Unknown or malformed slugs show the 404 page. Playwright covers the journeys and the contents on large and small screens, and axe scans every page type.
- CI migrates and seeds the e2e database. The seed gained weights and a hidden capability.
- The server's database pool has a connection timeout (5 seconds) and a statement timeout (10 seconds), so a slow database gives the 500 page instead of holding requests open. Idle connection errors are logged rather than stopping the server.
- **Written without running anything in the sandbox.** The developer ran `npm run db:reset`, `npm run format` and the checks on the host, and they pass. See [progress-phase4.md](progress-phase4.md#steps-to-run-on-the-host).

## Phase 5a: Migration inventory and extractor (2026-11-11)

- Tooling to migrate the current Hub from two plain folders outside the repo: the built HTML (`HUB_BUILD_DIR`) and the YAML data files (`HUB_DATA_DIR`). The old Hub's page sources aren't used, so the same tooling can later run against the built site in S3.
- `npm run migrate:inventory` accounts for every built page and data file, and reports pass or fail for each kind of input (`content`, `yaml`, `listing`, `redirect`, `unknown`).
  - Pages rendered from YAML are matched to their records and only become redirects, so nothing is migrated twice.
  - Hand-written pages are converted to markdown from the content area only, with links and image paths rewritten. Anything markdown can't show is flagged for manual review.
- YAML records are validated with shared Zod schemas, and every problem is collected. Each tool gets a placeholder instance, and a contract if it has commercial fields.
- Reports and logs hold paths, keys, counts and warnings only, never content.
- `npm run check:no-migration-data` runs in CI and in a pre-commit hook (`npm run hooks:install`).
- Tested on synthetic fixtures in the repo. The developer ran the inventory against the real Hub on the host, and every kind of input passes with no validation issues. 11 items need manual review.
- Part b adds the loader, redirects, verify and `docs/migration.md`, which lists the manual steps. See [progress-phase5.md](progress-phase5.md).

## Phase 5b: Migration loader, redirects and verify (2026-11-12)

- The migration reads its inputs from local folders or S3 (`s3://bucket/prefix/`) through the same code, so the run in AWS is the local command run as a one-off ECS task. Reports can go to S3 too.
- `npm run migrate:load` loads the plan through the repositories as `system:data_migration`, in one transaction. It is a dry run unless `--apply` is given. A second run changes nothing. Records an editor has changed are skipped, and nothing is deleted except stale links the migration made.
- It only writes to a local database unless `--database-host` names the host in `DATABASE_URL`, and it refuses a seeded database.
- `npm run migrate:verify` checks the database against the inputs and compares the new pages and redirects with the old site, using the app itself.
- A `redirects` table, served by a middleware on page not found. Real pages always win. `contracts.supplier_id` is now nullable.
- `docs/migration.md` lists every manual step: local runs, the AWS run, manual review and the cut-over checklist.
- **Written without running anything in the sandbox.** The tests were written first and agreed with the developer. The developer ran the checks, and migrated the real Hub into a local database and verified it, on the host.
- `docs/migration-validation.md` lets reviewers run the whole migration on the synthetic fixtures, with the exact results to expect. See [progress-phase5.md](progress-phase5.md#part-b-loader-redirects-and-verify).

## Before Phase 2: inputs to request

Supplied on 2026-11-10 in `db-reference-material/` (git-ignored) and used in Phase 2. The original request is kept below for reference.

The Phase 2 schema needs two inputs from the developer. They don't exist yet. When the Phase 2 session starts, check whether they've been supplied. If not, ask for them before proposing a plan, and don't design the schema without them.

- A structure-only summary of how the current static Hub is built. It should cover YAML files and fields, implied relationships and their cardinality (for example, tools used by more than one team), how templates combine data into pages, URL patterns and rough counts. Invented example values only.
- The developer's prototype schema, written in Ruby, to use as a starting point and translate to Drizzle. Where it differs from the relationships the YAML data implies, record the decision in the Phase 2 handover.
