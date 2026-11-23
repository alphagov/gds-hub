# GDS Hub re-write

Internal documentation tool for GDS. Server-rendered, database-backed, editable in the browser.

## Stack (ADR-FD004 - do not change without a new ADR)

Node 24 LTS, TypeScript (strict, ESM), Express, Nunjucks + govuk-frontend, Drizzle ORM, PostgreSQL 18,
Vitest, Playwright + @axe-core/playwright, Docker, Terraform, AWS ECS Express Mode.

## Commands

npm run dev | build | lint | typecheck | test | test:e2e
npm run db:generate | db:migrate | db:seed | db:reset
docker compose up -d db

## Architecture rules

- Use structured logging through the shared logger interface (library to be decided); no ad hoc console.log.
- Routes -> services -> repositories -> db. Only repositories import src/db.
- Every write goes through a repository and creates an audit_log row in the same transaction.
- Templates receive typed view models; no business logic in Nunjucks.
- Use official govuk-frontend macros only. Every page must pass axe WCAG 2.2 AA.
- Pages must work with JavaScript disabled.
- Markdown is rendered via src/lib/markdown.ts (sanitised). Never output unsanitised HTML.
- /edit/*, preview and /search responses are Cache-Control: no-store. Never include the Lambda@Edge JWT in the cache key for read pages.
- Never store passwords, tokens or credentials in the database.
- Secrets come from env vars (Secrets Manager in AWS). Never commit secrets.
- Migrations must be backward compatible (expand then contract).

## Identity (MVP)

- Viewing is open to anyone inside the WAF IP allow-list and authorised via Google sign-in Lambda@edge.
- Editing: the existing Lambda@Edge function forces Google sign-in and adds a JWT containing the user's email. Every /edit/* route reads the email from it and refuses requests with no token or email.
- Never trust the JWT without verifying it. Check the signature against the Lambda@Edge public key and check exp, iss and aud before reading the email; reject anything that fails. Never just decode it. Verification must not rely on the load balancer being unreachable directly.
- Tests use JWTs signed with keys generated during the test run. Never use or commit real keys or tokens: this is a public repo, and CI logs and artifacts are publicly downloadable.
- The email from the token is recorded in every audit_log entry. This is the MVP's verification of who made a change.
- No identity provider and no roles in the MVP (future requirement, Phase 7). Do not add Entra, Cognito, requireRole or role_assignments code.

## Data migration

- NEVER commit migrated or source data: no copies of current Hub files, exports, reports with content, or database dumps.
- The migration has two inputs: the built HTML (HUB_BUILD_DIR) and the YAML data files (HUB_DATA_DIR). Both are plain folders outside this repo and NOT available in the Claude Code sandbox. The old Hub's page source files (markdown, ERB, front matter) are not used. Never try to read, clone or build the real inputs or the old Hub; build and test against synthetic fixtures only. The developer runs inventory, verify and apply manually outside the sandbox. Output goes to the git-ignored migration-data/ and migration-reports/.
- Migrate page content from the built HTML (content area only, converted to markdown) and structured data from YAML. Built pages rendered from YAML are matched to their record and only become redirects, never pages, so nothing is migrated twice. Never execute Ruby/ERB.
- Migration test fixtures are hand-written synthetic samples (structure only, invented values). CI uses the synthetic seed; migrated data is for local databases only.
- npm run check:no-migration-data must pass before every commit.

## Sandbox

- The sandbox is the GDS Claude Policy Sandbox Kit plus this repo's mixin in .sbx/hub-dev. The developer starts it from the repo root with .sbx/claude-sandbox.sh, after docker compose up -d db (see README.md).
- Node 24, a Linux node_modules and Chromium are installed when the sandbox is created. localhost:5432 is the developer's database, and DATABASE_URL is set as in CI.
- Run lint, typecheck, test and test:e2e yourself, and fix failures before handing over. Before test:e2e on an empty database, run db:migrate and db:seed. Don't hand checks back to the developer unless one can't run in the sandbox; if so, say which and why in the phase's progress file.
- The database is the developer's local one. Ask the developer before running db:reset.
- Never run npm install, npx package downloads or add dependencies; the npm registry is blocked during the session. If one is missing, stop and list it in the phase's docs/progress/progress-phase<N>.md.
- Never run docker pull or git push. Commit locally only; the developer pushes and opens pull requests.

## Working agreement

- Work on ONE phase per session (see docs/build-plan.md). Start with the phase-handover skill and propose a plan before coding.
- Never put requirement IDs (R01, C01, PP1, A1, etc.) in test names, test descriptions or code comments.
- Playwright E2E tests cover user-facing, interactive behaviour only, named by what the user does and sees, e.g. test("preview shows the change without saving it").
- Unit tests (Vitest) cover individual functions and modules, plus behaviour where useful, named by behaviour.
- Stay in scope; log ideas in docs/backlog.md.
- Finish every phase in this order, using the project skills in .claude/skills:
  1. lint, typecheck, test and test:e2e all green
  2. phase-handover: write docs/progress/progress-phase<N>.md and the summary in docs/progress/progress.md
  3. security-scan: against docs/secure-ai-development-practices.md. Tell the developer about findings in the conversation only; never write them to a file
  4. pre-commit-review: review the change as an automated PR reviewer and fix what it finds
  5. commit locally
- Any other commit also goes through security-scan and pre-commit-review first.

## Language

British English in all UI copy. Follow GOV.UK style (plain English, sentence case).
