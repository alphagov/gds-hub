# GDS Hub

GDS Hub is an internal documentation tool for the Government Digital Service (GDS). It is a server-rendered web app backed by a database, and content can be edited in the browser.

This repository is a rewrite of the current Hub. It is being built in phases, which are set out in [docs/build-plan.md](docs/build-plan.md). At the moment it is a foundation skeleton: an Express server with configuration, logging, a health check, tests and a container setup.

## Technology

- Node.js 24 and TypeScript (strict mode, ES modules)
- Express 5
- PostgreSQL 18
- Vitest for unit tests and Playwright for end-to-end tests
- Docker and Docker Compose

Later phases add Nunjucks with the GOV.UK Design System (`govuk-frontend`), Drizzle ORM, Terraform and AWS ECS.

## Before you start

You need:

- [Node.js 24](https://nodejs.org/) and npm
- [Docker](https://docs.docker.com/get-docker/) with Docker Compose
- Playwright installed locally. `npx playwright install`

Install the dependencies:

```bash
npm install
```

## Run the app with Docker

This builds the app image and starts two containers, one for the app and one for the PostgreSQL database (`db`):

```bash
docker compose up -d
```

Check it is running:

```bash
curl http://localhost:3000/health
```

You should get a response like:

```json
{ "status": "ok", "version": "local", "uptime": 12 }
```

To stop everything, run `docker compose down`. Add `-v` to delete the database volume as well.

## Run the app locally for development

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Start the containers by following [Run the app with Docker](#run-the-app-with-docker).

3. Load the environment variables

   ```bash
   set -a; . ./.env; set +a
   ```

4. Create the tables and load the synthetic sample data:

   ```bash
   npm run db:reset
   ```

5. Start the app in watch mode:

   ```bash
   npm run dev
   ```

The app restarts when you change a file in `src/`. It runs at <http://localhost:3000>.

## Running Claude in the sandbox

Claude Code runs in the [GDS Claude Policy Sandbox Kit](https://github.com/alphagov/gds-claude-sbx-kit) with this repo's mixin in `.sbx/hub-dev`, so it can run lint, typecheck and the tests itself.

You need [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`) 0.54.0 or newer, set up as the kit's README describes: the Locked-Down policy, `kit.allowedSources` and the `bedrock-token` secret.

1. Start the database on your Mac:

   ```bash
   docker compose up -d db
   ```

2. From the repo root, start Claude:

   ```bash
   .sbx/claude-sandbox.sh
   ```

   The first run creates a sandbox called `hub-dev`, which takes about a minute and a half. Later runs reattach to it. Use `.sbx/claude-sandbox.sh --recreate` to start again from scratch.

When the sandbox is created, it installs:

- a Linux `node_modules`, with `npm ci --ignore-scripts`. It's kept in a sandbox volume, so your Mac's `node_modules` isn't changed
- Chromium and its system libraries, matching the Playwright version in `package-lock.json`

Node 24 comes with the base kit. Inside the sandbox, `localhost:5432` is the database on your Mac, and `DATABASE_URL` is set to the same value as CI.

The extra download sites are only open while the sandbox is being created. Once Claude is running, the sandbox can reach your Mac's port 5432, but it can't reach any site the base kit doesn't allow, or the npm registry. If a dependency is missing, add it on your Mac, then run `.sbx/claude-sandbox.sh --recreate`.

The database is the one on your Mac, so the sandbox uses your local data. `npm run db:seed` refuses a database that already has data, and `npm run db:reset` refuses to drop data the seed didn't create.

## Database

`npm run db:reset` is all you need to get a local database ready for development. It applies the migrations and loads synthetic sample data (made-up values only). Run it again whenever you want to start from a clean, seeded database. It reads `DATABASE_URL` from `.env`.

| Command               | What it does                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `npm run db:reset`    | Drops the app's tables, applies the migrations and seeds the data |
| `npm run db:generate` | Generates a new migration from changes to the Drizzle schema      |
| `npm run db:migrate`  | Applies pending migrations only, without seeding or dropping      |
| `npm run db:seed`     | Loads the synthetic sample data only                              |

`db:reset` and `db:seed` only run against a local database (`localhost`, `127.0.0.1`, `[::1]` or `db`). `db:reset` also checks what is in the database before it drops anything. It refuses if the database has tables this app doesn't create, imported data, or rows with no audit record of being created. If it refuses, run `docker compose down -v` to delete the database volume, then start the database again with `docker compose up -d db` and run `npm run db:reset`.

Migrations must be backward compatible (expand, then contract). After changing the schema, run `npm run db:generate` and commit the generated SQL.

## Migrating data from the current Hub

The migration loads the current Hub's built HTML and YAML data files into the database. See [docs/migration.md](docs/migration.md) for the steps, and [docs/migration-validation.md](docs/migration-validation.md) to check it works without the real files.

- Use a separate, empty database for migrated data. The loader refuses any database that has ever been seeded, so seed data and migrated data never mix.
- `npm run migrate:load` is a dry run unless you add `--apply`.
- Never commit the inputs, the reports or any migrated data. `npm run check:no-migration-data` checks this before every commit and in CI.

## Configuration

All configuration comes from environment variables. The app checks them when it starts. If a value is missing or invalid, it lists every problem and refuses to start.

| Variable                                                               | Default       | Description                                                                                                                                           |
| ---------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                             | `development` | `development`, `test` or `production`                                                                                                                 |
| `PORT`                                                                 | `3000`        | Port the app listens on                                                                                                                               |
| `LOG_LEVEL`                                                            | `info`        | `debug`, `info`, `warn` or `error`                                                                                                                    |
| `APP_VERSION`                                                          | `dev`         | Version reported by `/health`                                                                                                                         |
| `DATABASE_URL`                                                         | none          | Required. A `postgres://` or `postgresql://` connection URL                                                                                           |
| `DATABASE_HOST`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` | none          | Instead of `DATABASE_URL`, set all four (ECS passes them). The app builds the URL and verifies the server certificate                                 |
| `DATABASE_PORT`                                                        | `5432`        | Port for the database parts                                                                                                                           |
| `TRUST_PROXY_HOPS`                                                     | `0`           | Number of proxies in front of the app, a whole number from 0. Set it to `2` behind CloudFront and the load balancer so `req.ip` is the client address |

Docker Compose also reads these from `.env`:

| Variable        | Default | Description                                 |
| --------------- | ------- | ------------------------------------------- |
| `APP_HOST_PORT` | `3000`  | Port on your machine that serves the app    |
| `DB_HOST_PORT`  | `5432`  | Port on your machine that serves PostgreSQL |

Never commit `.env` or any real credentials. In AWS, secrets come from Secrets Manager.

## Scripts

| Command             | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm run dev`       | Starts the app in watch mode                                     |
| `npm run build`     | Compiles TypeScript from `src/` to `dist/`                       |
| `npm start`         | Runs the compiled app from `dist/`                               |
| `npm run lint`      | Runs ESLint and checks formatting with Prettier                  |
| `npm run format`    | Fixes formatting with Prettier                                   |
| `npm run typecheck` | Type-checks the app, the tests and the config files              |
| `npm test`          | Runs the Vitest unit tests                                       |
| `npm run test:e2e`  | Builds the app, starts it on port 3100 and runs Playwright tests |
| `npm run db:reset`  | Sets up the local database with migrations and sample data       |

The other database commands are in [Database](#database). The `migrate:*` and `check:no-migration-data` commands are in [docs/migration.md](docs/migration.md).

Before you open a pull request, run:

```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

The same checks run on every pull request in GitHub Actions ([.github/workflows/test.yml](.github/workflows/test.yml)), and must pass before the pull request can be merged. The workflow reads the Node version from `engines.node` in `package.json` and uses the same Postgres image as `docker-compose.yml`, so change those files rather than the workflow when versions change.

## Project structure

```
src/
  app.ts          builds the Express app (does not start a server)
  server.ts       loads config, starts the server and handles shutdown
  config.ts       reads and validates environment variables
  db/             database schema, seed data and the db:* scripts
  migration/      the inventory, load and verify scripts for the current Hub's data
  lib/            shared code, such as the logger
  middleware/     Express middleware, such as request IDs and request logging
  routes/         route handlers
  presenters/     turn records into the typed view models templates use
  services/       what routes call, such as the catalogue and content services
  repositories/   the only code that talks to the database
  types/          TypeScript type declarations
test/
  unit/           Vitest tests (*.test.ts)
  e2e/            Playwright tests (*.spec.ts)
  integration/    Vitest tests that need Postgres
docs/
  build-plan.md   the phased build plan
  progress/       progress.md (summary of each phase) and progress-phase<N>.md (full handover per phase)
  backlog.md      ideas that are out of scope for now
```

Requests flow from routes to services to repositories to the database. Only repositories talk to the database, and every write creates an audit log entry.

## Logging

The app writes structured JSON logs, one line per entry, to standard output. Every request gets an ID. The app reuses a valid `X-Request-Id` header if one is sent, or makes a new ID, and returns it in the `X-Request-Id` response header. Each request's log entries include that ID, so you can trace a request through the logs.

Use the shared logger in `src/lib/logger.ts` rather than `console.log`.

## Troubleshooting

**`docker compose up` fails with "port is already allocated" or "address already in use"**

Another program on your machine is already using port 3000 or 5432, often a local PostgreSQL. Choose a different host port in `.env`:

```
DB_HOST_PORT=5433
DATABASE_URL=postgres://gdshub:gdshub@localhost:5433/gdshub
```

To find out what is using a port, run `lsof -nP -iTCP:5432 -sTCP:LISTEN`.

**The app exits straight away with "invalid configuration"**

A required environment variable is missing or invalid. The log message names each one. Check your `.env` file and make sure you loaded it into your shell.

**Pages are empty or fail with "relation does not exist"**

The database isn't set up. Run `npm run db:reset`.

**`npm run db:reset` says "refusing to reset"**

The database holds something `db:reset` won't throw away, and the message says what. To start again, run `docker compose down -v`, then `docker compose up -d db` and `npm run db:reset`.

## Contributing

- Work follows the phases in [docs/build-plan.md](docs/build-plan.md).
- Write all user interface text in British English and follow the [GOV.UK style guide](https://www.gov.uk/guidance/style-guide).
- Every page must meet WCAG 2.2 AA and work without JavaScript.
- Never commit data from the current Hub, exports or database dumps. Tests use made-up sample data only.
- After each phase, add a handover note in `docs/progress/progress-phase<N>.md` and a summary in [docs/progress/progress.md](docs/progress/progress.md).

## Licence

[MIT licence](LICENCE)
