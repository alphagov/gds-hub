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
- Source and built HTML are read only from HUB_SOURCE_DIR and HUB_BUILD_DIR (outside this repo and NOT available in the Claude Code sandbox). Never try to read, clone or build them; build and test against synthetic fixtures only. The developer runs inventory, verify and apply manually outside the sandbox. Output goes to the git-ignored migration-data/ and migration-reports/.
- Migrate page content from the built HTML (content area only, converted to markdown) and structured data from YAML. Never execute Ruby/ERB.
- Migration test fixtures are hand-written synthetic samples (structure only, invented values). CI uses the synthetic seed; migrated data is for local databases only.
- npm run check:no-migration-data must pass before every commit.

## Sandbox

- No network access: never run npm install, npx package downloads, docker pull or git push.
- Dependencies are installed before the session. If one is missing, stop and list it in the phase's docs/progress/progress-phase<N>.md.
- Commit locally only; the developer pushes and opens pull requests.

## Working agreement

- Work on ONE phase per session (see docs/build-plan.md). Propose a plan before coding.
- Never put requirement IDs (R01, C01, PP1, A1, etc.) in test names, test descriptions or code comments.
- Playwright E2E tests cover user-facing, interactive behaviour only, named by what the user does and sees, e.g. test("preview shows the change without saving it").
- Unit tests (Vitest) cover individual functions and modules, plus behaviour where useful, named by behaviour.
- Stay in scope; log ideas in docs/backlog.md.
- Before finishing: lint, typecheck, test, test:e2e all green.
- Write the phase handover to docs/progress/progress-phase<N>.md (e.g. progress-phase0.md): what was built, key files, decisions, blockers, follow-ups.
- Add a high-level summary of the phase to docs/progress/progress.md (summary table row plus a few bullets) linking to the phase file.

## Language

British English in all UI copy. Follow GOV.UK style (plain English, sentence case).
