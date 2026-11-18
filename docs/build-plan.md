# GDS Hub re-write: MVP build plan

This file drives the build. Claude Code works on **one phase per session**.

## How to run a phase

1. Start a clean session (`/clear`).
2. Run the phase's **Before the session** commands yourself, outside the sandbox. Claude Code has no access to npm, Docker Hub or GitHub.
3. Paste the phase's **Prompt**. Claude Code proposes a plan; approve it before any code is written.
4. Don't move on until every **Done when** item passes.
5. Claude Code writes the phase handover to `docs/progress/progress-phase<N>.md`, adds a summary to `docs/progress/progress.md` and commits locally. You push the branch and open the pull request.
6. If a phase grows too big, stop at a green test run, write the handover note and continue in a new session labelled "part b".

### Session rules (every phase)

- Read `CLAUDE.md`, this phase's section of `docs/build-plan.md` and `docs/progress/progress.md` first, plus the previous phase's `docs/progress/progress-phase<N>.md`.
- Never run `npm install`, `npx` downloads, `docker pull` or `git push`. If a package is missing, stop and list it in the phase's `docs/progress/progress-phase<N>.md`.
- Only touch the files the phase needs. Put out-of-scope ideas in `docs/backlog.md`.
- Write tests first where practical. Name tests after the behaviour they check, never after requirement IDs.
- Playwright tests cover user-facing behaviour only. Vitest covers functions and modules.
- Every pull request runs `.github/workflows/test.yml` (lint, typecheck, Vitest, Playwright) and must pass before merging. If a phase adds a check, a service or a browser, update the workflow in the same phase.
- Finish with: `npm run lint && npm run typecheck && npm test && npm run test:e2e`, then a `docs/progress/progress-phase<N>.md` handover (what was built, key files, decisions, follow-ups), a high-level summary in `docs/progress/progress.md`, and a local commit.

## MVP scope at a glance

- **Viewing:** anyone inside the WAF IP allow-list and authorised via Google in Lambda@edge.
- **Editing:** the existing Lambda@Edge function forces Google sign-in and adds a JWT containing the user's email. Every `/edit/*` route verifies the JWT (signature, expiry, issuer and audience), reads the email and refuses requests with no token, an invalid token or no email. The email is recorded in every audit entry, which is the MVP's verification of who made a change.
- **No identity provider and no roles in the MVP.** Anyone who can sign in can edit, and saves publish straight away. Identity provider sign-in and roles (Phase 7) come after the MVP.

## Requirement IDs

These are for planning only. Never put them in test names, test descriptions or code comments.

| ID       | Requirement                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| R01      | Developers can see what tools they can use and how to access them                                                     |
| R02      | Audit log for all data changes, with previous values                                                                  |
| R03      | Readers know when information was last updated                                                                        |
| R04      | Owners of shared technical services have a place for guidance                                                         |
| R05      | Developers can read a policy to check they comply                                                                     |
| R06      | Non-technical tool managers can update their information                                                              |
| R07      | Technical writers can update Hub content (markdown)                                                                   |
| R08      | The data model represents SaaS tool instances                                                                         |
| R09      | InfoSec can publish policies                                                                                          |
| R10      | Writers can preview before going live                                                                                 |
| R11      | The team is told when the Hub is down; users see maintenance notices                                                  |
| R12      | Content is searchable                                                                                                 |
| R13      | Uses the GOV.UK Design System                                                                                         |
| R14      | Backed by a database                                                                                                  |
| R15      | Editable through the web interface                                                                                    |
| R16      | Server-side rendered                                                                                                  |
| C03      | Edits are attributable to a named person (email from the Lambda@Edge JWT)                                             |
| PP1–PP6  | Avoid: confusing navigation, inefficient search, no update timeline, inflexible templates, no monitoring, long builds |
| C01, C02 | Future (Phase 7): access control and role-based permissions                                                           |

## Phase overview

| Phase | Name                                    | Requirements            | Depends on                    |
| ----- | --------------------------------------- | ----------------------- | ----------------------------- |
| P0    | Foundations and tooling                 | PP6                     | none                          |
| P1    | GOV.UK shell and server-side rendering  | R13, R16, PP1, PP4      | P0                            |
| P2    | Schema, migrations and seed             | R08, R14                | P0                            |
| P3    | Repositories and audit service          | R02, R03, C03           | P2                            |
| P4    | Read journeys                           | R01, PP1                | P1, P3                        |
| P5    | Data migration from the current Hub     | All existing content    | P2, P3, P4                    |
| P6    | Content pages                           | R04, R05, R09, PP4      | P4, P5                        |
| P8    | Web editing                             | R06, R07, R15, C03      | P6                            |
| P9    | Preview                                 | R10                     | P8                            |
| P10   | Search                                  | R12, PP2                | P6                            |
| P11   | Freshness and change history            | R02, R03, PP3           | P8                            |
| P12   | Caching and invalidation                | Viewer and editor flows | P8                            |
| P13   | Infrastructure as code                  | R14                     | P0 (can run alongside P1–P12) |
| P14   | CI/CD pipeline                          | PP6                     | P13                           |
| P15   | Monitoring and alerting                 | R11, PP5                | P13, P14                      |
| P7    | Sign-in and roles (**future, not MVP**) | C01, C02                | MVP live                      |

The phase numbers are unchanged, so Phase 8 still follows Phase 6.

---

## Phase 0: Foundations and tooling

**Goal:** a runnable, tested, containerised Express and TypeScript skeleton.
**Out of scope:** UI, database schema, AWS resources.

### Done when

- `docker compose up` serves `/health`.
- Lint, typecheck and both test suites pass.
- The Docker image builds in under 60 seconds locally.

**Handover:** folder conventions, script names, config module API.

---

## Phase 1: GOV.UK shell and server-side rendering

**Goal:** every page renders server-side through one GOV.UK Frontend layout that passes accessibility checks.
**Out of scope:** data-driven content (use placeholder pages).

### Done when

- Placeholder pages render with GOV.UK styling.
- axe finds zero violations.
- Pages work with JavaScript turned off.

**Handover:** layout block names, view-model convention, how to add a route and template.

---

## Phase 2: Schema, migrations and seed

**Goal:** the data model in Drizzle, with migrations, search columns and synthetic seed data.
**Out of scope:** repositories, routes, audit logic, importing real content.

### Done when

- `db:reset` runs cleanly against a fresh Postgres.
- The foreign key test passes.
- There are no credential columns in the schema.

**Handover:** table list, enum names, search view columns, seed commands.

---

## Phase 3: Repositories and audit service

**Goal:** one typed data-access layer that audits every create, update and delete in the same transaction.
**Out of scope:** HTTP routes and UI.

### Done when

- All writes go through repositories (enforced by lint).
- The audit tests pass, including the rollback case.

**Handover:** repository API signatures and how an Actor is built.

---

## Phase 4: Read journeys

**Goal:** developers can browse to any tool and see how to get access.
**Out of scope:** editing, policies, search.

### Done when

- Access instructions for any seeded tool are reachable in 3 clicks or fewer.
- axe passes on every page type.

**Handover:** route table, view-model names, reusable partials.

---

## Phase 5: Data migration from the current Hub

**Goal:** repeatable tooling that moves all current Hub content into PostgreSQL early. It reads two inputs, the built HTML and the YAML data files, is tested separately for each kind of input (content pages, YAML data, listings, redirects) and **never commits migrated data**.
**Sandbox boundary:** Claude Code has no access to the real Hub source or built HTML. It builds and tests against synthetic fixtures only. You run everything against real content yourself, after the session.
**Out of scope:** changing content during migration; hosting images and downloads (listed in the report and decided separately).

### Done when

- **In the session:** tests pass on fixtures for every kind of input, including a second run that changes nothing. `docs/migration.md` lists every manual step.
- **Outside the sandbox:** every built page and YAML file is accounted for; the real-data check passes for each kind of input; the manual-review list is agreed with content owners; the Phase 4 pages run on migrated data.
- **Both:** `check:no-migration-data` passes.

**Handover:** script options, required settings, mapping files, manual-review process, cut-over checklist.

---

## Phase 6: Content pages (policies and service guidance)

**Goal:** long-form, owned, dated content for policies and shared-service guidance.
**Out of scope:** editing.

### Done when

- Seeded policies and guides render accessibly.
- The XSS tests pass.
- A migrated page of each page type renders, and old URLs redirect.

**Handover:** markdown helper API and page-type routes.

---

## Phase 8: Web editing

**Goal:** signed-in editors can create, edit and delete any entity in the browser using accessible GOV.UK forms.
**Editor identity (MVP):** no identity provider and no roles. Express verifies the Lambda@Edge JWT (signature against the Lambda@Edge public key, `exp`, `iss`, `aud`), reads the email and records it in the audit log. It never just decodes the token. Saves publish straight away.
**Out of scope:** preview, cache invalidation, roles and draft approval.

### Done when

- Every entity supports create, update and delete in the browser.
- Each change produces an audit row recording the editor's email.
- Error states pass axe.
- Edit requests without a token, or with no email in it, are refused.
- Edit requests with a forged, wrongly signed, expired or wrong-audience token are refused. Tests sign tokens with keys generated during the test.

**Handover:** how to add a new editable entity (configuration only).

---

## Phase 9: Preview

**Goal:** editors see exactly how a change will look before it goes live.

### Done when

- Preview never writes to the database.
- A tampered payload is rejected.

**Handover:** preview flag in view models and the signing helper.

---

## Phase 10: Search

**Goal:** fast, ranked search across every content type.
**Out of scope:** vector or AI search.

### Done when

- A title match ranks above a body match.
- p95 query time is under 100 ms.
- The search page passes axe.

**Handover:** search service API and how to make a new table searchable.

---

## Phase 11: Freshness and change history

**Goal:** readers see how current content is and what changed, when and by whom.
**Out of scope:** restoring old versions.

### Done when

- After an edit, history shows the previous value.
- The "Last updated" date changes.
- axe passes.

**Handover:** partial names and the staleness setting.

---

## Phase 12: Caching and invalidation

**Goal:** reads are served from the CloudFront cache, and saved changes appear straight away.
**Out of scope:** creating the CloudFront distribution (Phase 13).

### Done when

- The header policy tests pass.
- Path mapping covers every entity type.
- No `/edit/*` response can be cached.

**Handover:** path-mapping table and the IAM permission `cloudfront:CreateInvalidation`.

---

## Phase 13: Infrastructure as code

**Goal:** repeatable pre-prod and prod environments.
**Out of scope:** pipelines (Phase 14), alarms (Phase 15), identity provider resources (future).

### Done when

- `terraform validate` passes for both environments.
- A platform engineer has reviewed the plan.
- The load balancer is not reachable directly.
- The Lambda@Edge sign-in function is attached in both environments.

**Handover:** outputs (distribution ID, ECR URL, secret ARNs) and per-environment variables.

---

## Phase 14: CI/CD pipeline

**Goal:** merges deploy to pre-prod, then to prod after approval. Pull requests are already tested by `.github/workflows/test.yml` (added after Phase 0); this phase builds on it rather than replacing it.
**Out of scope:** per-PR preview environments.

### Done when

- A merge deploys to pre-prod automatically.
- Prod needs approval and uses the same image digest.

**Handover:** workflow names, required secrets and variables, rollback steps.

---

## Phase 15: Monitoring and alerting

**Goal:** the team and product managers find out quickly when the Hub is unhealthy or in maintenance.
**Out of scope:** a full observability platform.

### Done when

- A test alarm reaches the email subscribers.
- The maintenance banner can be switched on through configuration.
- The runbook exists.

**Handover:** alarm names, SNS topic, maintenance procedure.

---

## Future (not MVP): Phase 7, sign-in and roles

Do not start until the MVP is live. When picked up, this phase replaces the Lambda@Edge email lookup on `/edit/*` with a real identity provider session and roles.

- **Identity provider:** Entra ID SSO with the DSIT tenant (preferred) or a Cognito user pool in our AWS account (fallback), selected by `IDP_PROVIDER=entra|cognito` and built behind one provider-neutral interface in `src/auth/`.
- **Sign-in:** `openid-client` with authorisation code and PKCE. Routes `/auth/sign-in`, `/auth/callback` and `/auth/sign-out`. An encrypted, HTTP-only session cookie lasting 8 hours.
- **Roles:** viewer, writer and admin, cumulative.
  - Entra: roles stored in a `role_assignments` table keyed on tenant ID and object ID.
  - Cognito: roles are Cognito groups.
  - `requireRole` protects every `/edit/*` and `/admin/*` route.
- **Admin screen:** `/admin/members` adds and removes members. It prevents removing the last admin.
- **Draft approval:** drafts and admin-only publishing are switched on (the `content_status` enum already exists).
- **Break-glass:** a `grant-admin` script, run only as an audited one-off ECS task.
- **Infrastructure:** Phase 13 Terraform gains the Entra secrets or the Cognito user pool. Phase 14 CI runs the auth E2E tests against `oauth2-mock-server`.
