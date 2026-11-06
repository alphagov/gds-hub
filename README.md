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

Install the dependencies:

```bash
npm install
```

## Run the app with Docker

This builds the app image and starts it with a PostgreSQL database:

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

2. Start only the database:

   ```bash
   docker compose up -d db
   ```

3. Load the environment variables and start the app in watch mode:

   ```bash
   set -a; . ./.env; set +a
   npm run dev
   ```

The app restarts when you change a file in `src/`. It runs at <http://localhost:3000>.

## Configuration

All configuration comes from environment variables. The app checks them when it starts. If a value is missing or invalid, it lists every problem and refuses to start.

| Variable       | Default       | Description                                                 |
| -------------- | ------------- | ----------------------------------------------------------- |
| `NODE_ENV`     | `development` | `development`, `test` or `production`                       |
| `PORT`         | `3000`        | Port the app listens on                                     |
| `LOG_LEVEL`    | `info`        | `debug`, `info`, `warn` or `error`                          |
| `APP_VERSION`  | `dev`         | Version reported by `/health`                               |
| `DATABASE_URL` | none          | Required. A `postgres://` or `postgresql://` connection URL |

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
  lib/            shared code, such as the logger
  middleware/     Express middleware, such as request IDs and request logging
  routes/         route handlers
  types/          TypeScript type declarations
test/
  unit/           Vitest tests (*.test.ts)
  e2e/            Playwright tests (*.spec.ts)
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

## Contributing

- Work follows the phases in [docs/build-plan.md](docs/build-plan.md).
- Write all user interface text in British English and follow the [GOV.UK style guide](https://www.gov.uk/guidance/style-guide).
- Every page must meet WCAG 2.2 AA and work without JavaScript.
- Never commit data from the current Hub, exports or database dumps. Tests use made-up sample data only.
- After each phase, add a handover note in `docs/progress/progress-phase<N>.md` and a summary in [docs/progress/progress.md](docs/progress/progress.md).

## Licence

[MIT licence](LICENCE)
