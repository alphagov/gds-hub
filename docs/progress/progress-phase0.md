# Phase 0: Foundations and tooling

**Date:** 2026-11-04

**Status:** code complete. Lint, typecheck, build and the Playwright e2e test pass in the sandbox. Vitest and Docker could not be run in the sandbox (see Blockers); the developer validates them on the host.

## What was built

- Express 5 + TypeScript (strict, ESM, `nodenext`) skeleton with an app factory and a separate server entry point.
- Zod-validated config loaded from env vars; startup fails fast, listing every invalid value.
- Structured JSON logger behind a small `Logger` interface; request-id middleware; per-request log line; helmet; compression.
- `GET /health` returning `{ status, version, uptime }` with `Cache-Control: no-store`.
- Vitest unit tests (health, config, logger, request id) and one Playwright test for `/health`.
- Multi-stage Dockerfile on `node:24-alpine` (non-root `node` user, `HEALTHCHECK`), and `docker-compose.yml` with `app` and `postgres:18-alpine`.

## Folder conventions

```
src/
  app.ts                 createApp({ config, logger }): Express (never listens)
  server.ts              loads config, listens, graceful shutdown on SIGTERM/SIGINT
  config.ts              loadConfig(env) -> Config, ConfigError
  lib/                   shared utilities (logger.ts; markdown.ts goes here later)
  middleware/            Express middleware factories (request-id.ts, request-logger.ts)
  routes/                one router factory per area (health.ts)
  types/                 ambient declarations (Express res.locals, temporary module types)
test/
  unit/                  Vitest, *.test.ts; helpers.ts has startApp() and testConfig
  e2e/                   Playwright, *.spec.ts
```

Later phases add `src/services/`, `src/repositories/` and `src/db/` (only repositories import `src/db`).
Relative imports use the `.js` extension (ESM `nodenext`).

## Scripts

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run dev`       | `tsx watch src/server.ts` (needs a `.env` or exported env vars)    |
| `npm run build`     | compiles `src/` to `dist/` with `tsconfig.build.json`              |
| `npm start`         | `node dist/server.js`                                              |
| `npm run lint`      | ESLint (typescript-eslint strict, type-checked) + Prettier check   |
| `npm run format`    | Prettier write                                                     |
| `npm run typecheck` | `tsc --noEmit` over `src`, `test` and config files                 |
| `npm test`          | Vitest, `test/unit/**/*.test.ts`                                   |
| `npm run test:e2e`  | Playwright; builds and starts the server on port 3100 (`E2E_PORT`) |

## Config module API

`loadConfig(env = process.env): Config` returns a frozen object, or throws `ConfigError` (`.issues: string[]`). Empty strings count as unset.

| Env var        | Config field  | Default       | Notes                                          |
| -------------- | ------------- | ------------- | ---------------------------------------------- |
| `NODE_ENV`     | `nodeEnv`     | `development` | `development`, `test` or `production`          |
| `PORT`         | `port`        | `3000`        | integer 1 to 65535                             |
| `LOG_LEVEL`    | `logLevel`    | `info`        | `debug`, `info`, `warn` or `error`             |
| `APP_VERSION`  | `version`     | `dev`         | set by the Docker build arg                    |
| `DATABASE_URL` | `databaseUrl` | required      | must be a `postgres://` or `postgresql://` URL |

Add new settings to the Zod schema and the `Config` interface in `src/config.ts`, and to `.env.example`.

## Logger API

`Logger` has `debug`, `info`, `warn` and `error(message, fields?)`, plus `child(fields)`. `createJsonLogger({ level, base?, write?, now? })` writes one JSON line per entry (errors go to stderr) and serialises `Error` values. `silentLogger` is for tests. Inside a request, use `res.locals.logger`, which already carries `requestId`. Only `src/lib/logger.ts` may call `console` (enforced by ESLint).

## Decisions

- No supertest: unit tests start the app on port 0 and use `fetch` (`test/unit/helpers.ts`).
- The Playwright `/health` test uses the `request` fixture, so no browser download is needed yet.
- An incoming `X-Request-Id` is reused only if it matches `[A-Za-z0-9._-]{1,128}`; otherwise a UUID is generated.
- The 404 and error handlers return JSON for now; Phase 1 replaces them with GOV.UK HTML pages.
- `DATABASE_URL` is required now, even though nothing connects yet, so deployment config is right from the start.
- The Dockerfile runs `npm ci --ignore-scripts` and has a separate production-deps stage, so the runtime image has no dev dependencies.
- Compose publishes ports on `127.0.0.1` only. Host ports come from `APP_HOST_PORT` (default 3000) and `DB_HOST_PORT` (default 5432), so they don't clash with a local Postgres. Inside the compose network the app always uses `db:5432`.
- ESLint turns off `no-unsafe-assignment` in `test/` because Vitest's asymmetric matchers are typed as `any`.

## Blockers and missing packages

- `node_modules` was installed on macOS, so the Linux sandbox lacks `@esbuild/linux-arm64` and `@rolldown/binding-linux-arm64-gnu`. `tsx` (`npm run dev`) and Vitest don't run in the sandbox.
- `@types/compression` is missing. A temporary declaration lives in `src/types/compression.d.ts`; delete it after installing the package.
- No Docker images in the sandbox (`node:4-alpine`, `postgres:18-alpine`), so the image build, `docker compose up` and the under-60-second build target were not checked in the sandbox.
- The sandbox runs Node 22.22; the target is Node 24.

## Follow-ups

- Add `npm run check:no-migration-data` (CLAUDE.md requires it before every commit; it doesn't exist yet).
- Pick a logging library (for example pino) and implement it behind `Logger`.
- Set `trust proxy` correctly once the ALB and CloudFront topology is known (Phase 13).

## Pull request testing

Added on 2026-11-06, after the phase was completed.

`.github/workflows/test.yml` runs on every pull request (and manually through `workflow_dispatch`). It has three jobs, which show as separate status checks:

| Job (status check name)         | Runs                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `Lint and typecheck`            | `npm run lint`, `npm run typecheck`                                                      |
| `Unit tests (Vitest)`           | `npm test`, with a `postgres:18-alpine` service                                          |
| `End-to-end tests (Playwright)` | `npx playwright install --with-deps chromium`, `npm run test:e2e`, with the same service |

- **Versions:** `actions/setup-node` reads `node-version-file: package.json`, so the Node version comes from `engines.node`, the same major version as the `node:24-alpine` Docker image. The Postgres service uses the `docker-compose.yml` image and credentials. Playwright installs the browser for the locked `@playwright/test` version.
- `DATABASE_URL` is set at workflow level to match `playwright.config.ts`. Nothing connects to the database yet; the service is there for Phase 2 onwards.
- Playwright `test-results/` are uploaded as an artifact when the e2e job fails.
- Concurrency cancels superseded runs on the same pull request. The workflow token is read-only (`contents: read`).
- Not validated in the sandbox: no Node, YAML parser or `actionlint` was available. The first pull request run is the real check.
