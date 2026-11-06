# Progress log

A short summary of each completed phase. The full handover for each phase (what was built, key files, decisions, blockers and follow-ups) is in its own file, `docs/progress/progress-phase<N>.md`.

| Phase | Name                    | Date       | Status        | Handover                                 |
| ----- | ----------------------- | ---------- | ------------- | ---------------------------------------- |
| P0    | Foundations and tooling | 2026-11-04 | Code complete | [progress-phase0.md](progress-phase0.md) |

## Phase 0: Foundations and tooling (2026-11-04)

- Express 5 and TypeScript (strict, ESM) skeleton with an app factory, Zod-validated config, a structured JSON logger behind a `Logger` interface, request IDs and `GET /health`.
- Vitest unit tests and a Playwright test for `/health`.
- Multi-stage Dockerfile on `node:24-alpine` and `docker-compose.yml` with `app` and `postgres:18-alpine`.
- **Not verified in the sandbox:** Vitest, the Docker image build and `docker compose up` (missing Linux native binaries and Docker images). The developer validates these on the host.
- **Missing packages:** `@types/compression`, plus the Linux `@esbuild` and `@rolldown` native bindings.
- **Key follow-ups:** add `npm run check:no-migration-data` (and add it to the test workflow), choose a logging library, set `trust proxy` in Phase 13.
- **Pull request testing (added 2026-11-06):** `.github/workflows/test.yml` runs lint and typecheck, Vitest and Playwright on every pull request, with Node from `engines.node` and the `postgres:18-alpine` service. The developer marks the three jobs as required checks in branch protection. See [progress-phase0.md](progress-phase0.md#pull-request-testing).
- **Security hardening (2026-11-06):** actions pinned to SHAs, `persist-credentials: false`, `npm ci --ignore-scripts`, Dependabot for actions, npm and Docker images. JWT verification is now a rule for Phase 8. Docker images pinned by digest. Outstanding: apply the repository settings, and change `@types/node` to `^24`.

## Before Phase 2: inputs to request

The Phase 2 schema needs two inputs from the developer. They don't exist yet. When the Phase 2 session starts, check whether they've been supplied. If not, ask for them before proposing a plan, and don't design the schema without them.

- A structure-only summary of how the current static Hub is built. It should cover YAML files and fields, implied relationships and their cardinality (for example, tools used by more than one team), how templates combine data into pages, URL patterns and rough counts. Invented example values only.
- The developer's prototype schema, written in Ruby, to use as a starting point and translate to Drizzle. Where it differs from the relationships the YAML data implies, record the decision in the Phase 2 handover.
