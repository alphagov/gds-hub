# Checking the migration yourself

A step-by-step guide for anyone reviewing the Phase 5 migration: the inventory, the loader, redirects and verify. It takes about 30 minutes.

You don't need the current Hub's files. [Part 3](#3-run-the-migration-on-the-synthetic-fixtures) runs everything end to end on the synthetic fixtures in this repository, and gives the exact results to expect. [Part 6](#6-optional-run-it-on-the-real-hub) is for people who have a copy of the current Hub's inputs.

[`migration.md`](migration.md) is the reference for every option, and for running the migration in AWS. This guide covers checking it works.

## Ground rules

- **Never commit the current Hub's files**, a report from a run on them, or a database dump. `npm run check:no-migration-data` checks for these. Run `npm run hooks:install` once, so it also runs before every commit.
- **Everything here uses throwaway databases** in the docker compose Postgres. Your usual seeded database, which the e2e tests use, isn't touched.
- **When you report back, send counts, codes and keys only.** Never send content from the current Hub. The fixtures are invented, so anything from them is fine to share.

## 1. Before you start

You need:

- Node 24, with `npm ci` run in the repository
- Docker, with the docker compose database: `docker compose up -d db`
- `jq`, to read the reports (`brew install jq` on a Mac). You can open the JSON files instead.

Check the branch passes, running each command on its own line or joined with `&&`:

```sh
npm run lint && npm run typecheck
npm test
npm run db:reset && npm run test:e2e
npm run check:no-migration-data
```

`db:reset` migrates and reseeds your usual database, which the e2e tests need. If it fails because the database has migrated data in it, you pointed `.env` at a migration database. See [Troubleshooting](#7-troubleshooting).

## 2. Set up

### Find your database port

The docker compose database listens on `DB_HOST_PORT` from your `.env`, or 5432 if that isn't set. If another Postgres already uses 5432 on your machine, set `DB_HOST_PORT=5433` in `.env`, change the port in `DATABASE_URL` to match, and run `docker compose up -d db` again.

In the terminal you'll use for this guide:

```sh
export DB_PORT=5432   # or your DB_HOST_PORT
```

### Clear the migration settings from `.env`

If your `.env` sets any `HUB_` or `MIGRATION_` settings, comment them out while you use the fixtures. The scripts read them, and a content selector or strip-list meant for the real Hub changes the fixture results. Command-line options override `.env`, but only the options you give.

### Make a database for the fixtures

```sh
docker compose exec db createdb -U gdshub gdshub_fixtures
export FIXTURES_DB=postgres://gdshub:gdshub@localhost:$DB_PORT/gdshub_fixtures
DATABASE_URL=$FIXTURES_DB npm run db:migrate
```

`docker compose exec` runs inside the container, so it works whatever port the database has on your machine.

### A shortcut for the fixture inputs

Every script needs the same 4 options for the fixtures. This shell function adds them, and works in bash and zsh:

```sh
fixtures() {
  "$@" --data test/fixtures/migration/hub-data \
    --build test/fixtures/migration/hub-build \
    --site-origin https://hub.example.com \
    --content-selector main
}
```

You use it like this, keeping the `--` at the end, which npm needs to pass the options on to the script:

```sh
fixtures npm run migrate:inventory --
```

Relative paths are read from the repository root, where npm runs the scripts.

A shortcut for looking at the database:

```sh
sql() { docker compose exec -T db psql -U gdshub -d gdshub_fixtures -c "$1"; }
```

And for the newest report of each kind:

```sh
latest() { ls -t migration-reports/"$1"-*.json | head -1; }
```

## 3. Run the migration on the synthetic fixtures

### 3.1 Take an inventory

```sh
fixtures npm run migrate:inventory --
echo "exit code: $?"
```

**Expect:** exit code 0, and a log line `inventory passed`.

```sh
jq '.summary[] | {group, items, migrated, skipped, manualReview, records, passed}' "$(latest inventory)"
jq '.recordCounts' "$(latest inventory)"
```

**Expect:** every group passes:

| Group      | Items | Records |
| ---------- | ----- | ------- |
| `content`  | 8     | 8       |
| `yaml`     | 18    | 16      |
| `listing`  | 11    | 0       |
| `redirect` | 1     | 28      |
| `unknown`  | 1     | 0       |

The record counts are `tool` 3, `contract` 1, `instance` 5, `ownership_level` 2, `capability` 2, `product_team_service` 2, `business_unit` 1, `page` 8 and `redirect` 28. Some items are `manual_review` on purpose: the fixtures include a data file the migration doesn't know, a listing with no replacement, a page with no content area, and pages with things markdown can't show.

### 3.2 Do a dry run

```sh
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:load --
echo "exit code: $?"
```

**Expect:** exit code 0, and the last log line `dry run: nothing was written`.

```sh
jq '{applied, passed, summary: [.summary[] | select(.records > 0)], links, skipped, onlyInDatabase}' "$(latest load)"
sql "SELECT count(*) FROM audit_log"
```

**Expect:**

- `applied` is false and `passed` is true.
- All 52 records are `created`: 16 in `yaml`, 8 in `content` and 28 in `redirect`.
- Links added: `capability_tool` 3, `product_team_service_instance` 2 and `business_unit_product_team_service` 2.
- `skipped` and `onlyInDatabase` are empty.
- The audit log has **0** entries. The dry run made every write, then rolled them all back.

### 3.3 Apply

```sh
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:load -- --apply
echo "exit code: $?"
```

**Expect:** exit code 0, and the last log line `applied`. Then check the database:

```sh
sql "SELECT entity_type, action, count(*) FROM audit_log GROUP BY 1, 2 ORDER BY 1"
sql "SELECT DISTINCT actor_subject, request_id FROM audit_log"
jq -r '.runId' "$(latest load)"
```

**Expect:**

- 59 `create` entries in all: one for each of the 52 records and 7 links.
- Every entry is by `system:data_migration`, with the same request ID: the run ID in the load report.

Spot-check a few rows:

```sh
sql "SELECT key, name FROM tools ORDER BY key"
sql "SELECT t.key AS tool, c.supplier_id, c.cost_model FROM contracts c JOIN tools t ON t.id = c.tool_id"
sql "SELECT old_path, new_path FROM redirects ORDER BY old_path"
```

**Expect:**

- 3 tools: `kettle-board`, `lanternly` and `quillstack`.
- One contract, for `kettle-board`, with no supplier.
- 28 redirects, including `/tools/lantern-notes-wiki/` to `/tools/lanternly` and `/old-widgets.html` to `/guidance/widgets`.

### 3.4 Run it again: it changes nothing

```sh
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:load -- --apply
jq '[.summary[] | select(.records > 0) | {group, created, updated, unchanged}], .links' "$(latest load)"
sql "SELECT count(*) FROM audit_log"
```

**Expect:** exit code 0. All 52 records are `unchanged`, every link count is 0 apart from `unchanged`, and the audit log still has **59** entries.

### 3.5 Verify

```sh
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:verify --
echo "exit code: $?"
jq '{passed, checked, problems, warnings, waitingForPhase6}' "$(latest verify)"
```

**Expect:**

- Exit code 0, and the log line `verify passed`.
- `checked` is `{ "records": 52, "pages": 10, "redirects": 28 }`.
- `problems` and `warnings` are empty.
- `waitingForPhase6` lists the content pages, including `/policies/device-policy`, `/guidance/widgets` and `/pages/about`. Their pages are in the database, but their routes come in Phase 6.

Verify started the app on a random local port and fetched every new page and every old address. Its log lines tagged `verify-app` are the app's own request logs.

### 3.6 Check the reports hold no content

```sh
grep -l -e "Ask in the example channel" -e "builds example paper planes" migration-reports/*.json || echo "no content found"
```

**Expect:** `no content found`. Both phrases are in the fixtures. Reports only hold paths, keys, field names and counts.

## 4. Look at the pages

```sh
DATABASE_URL=$FIXTURES_DB npm run dev
```

`npm run dev` doesn't read `.env`, so it only uses the settings in front of it. Put `PORT=3001` in front too if something else uses port 3000. Then open:

| Address                                                                                  | What to check                                                                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| http://localhost:3000/                                                                   | The home page lists Note taking under Collaboration. Build pipelines is hidden from navigation in the fixtures |
| http://localhost:3000/tools                                                              | Kettle Board, Lantern Notes & Wiki and Quillstack                                                              |
| http://localhost:3000/tools/kettle-board                                                 | How to get access, the migration status, and a contract titled just "Contract"                                 |
| http://localhost:3000/instances/kettle-board-main                                        | The instance and its tool                                                                                      |
| http://localhost:3000/capabilities/note-taking                                           | Its tools                                                                                                      |
| http://localhost:3000/services/paper-planes                                              | The team's details, such as its Slack channel, and its business unit                                           |
| http://localhost:3000/business-units/skyward-directorate                                 | Its 2 teams                                                                                                    |
| http://localhost:3000/tools/lantern-notes-wiki/                                          | **Redirects** to `/tools/lanternly`, the tool's old address                                                    |
| http://localhost:3000/products_teams_and_services/skyward-directorate/paper-planes-team/ | **Redirects** to `/services/paper-planes`                                                                      |
| http://localhost:3000/old-widgets.html                                                   | Redirects to `/guidance/widgets`, which shows page not found until Phase 6                                     |

To see a redirect without the browser following it:

```sh
curl -sI http://localhost:3000/tools/lantern-notes-wiki/ | grep -i -e "^HTTP" -e "^location"
```

**Expect:** `HTTP/1.1 301 Moved Permanently` and `Location: /tools/lanternly`.

Stop the server with Ctrl+C.

## 5. Check the safety rules

Each check changes the fixtures database on purpose, so do them in this order, after part 3. Part 8 drops the database afterwards.

### 5.1 Verify finds a problem, and a load repairs it

```sh
sql "DELETE FROM redirects WHERE old_path = '/old-widgets.html'"
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:verify --; echo "exit code: $?"
jq '.problems' "$(latest verify)"
```

**Expect:** exit code 1, with problems for `/old-widgets.html`, one of them with code `redirect_missing`. Now load again, and verify:

```sh
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:load -- --apply
jq '.changes' "$(latest load)"
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:verify --; echo "exit code: $?"
```

**Expect:** the load creates just that one redirect, and verify passes again with exit code 0.

### 5.2 A record an editor has changed is never overwritten

The audit log is how the loader knows a person changed a record. This stands in for an edit made in the browser, which Phase 8 adds:

```sh
sql "UPDATE tools SET name = 'Quillstack (edited)' WHERE key = 'quillstack'"
sql "INSERT INTO audit_log (entity_type, entity_id, action, before, after, changed_fields, actor_name, actor_subject)
     SELECT 'tool', id, 'update', '{}', '{}', '[\"name\"]', 'reviewer@example.com', 'reviewer@example.com'
     FROM tools WHERE key = 'quillstack'"
DATABASE_URL=$FIXTURES_DB fixtures npm run migrate:load -- --apply; echo "exit code: $?"
jq '{passed, skipped}' "$(latest load)"
sql "SELECT name FROM tools WHERE key = 'quillstack'"
```

**Expect:** exit code 1, `passed` is false, and `skipped` lists `tool` `quillstack` because an editor has changed it. The name is still `Quillstack (edited)`.

Compare a change made outside the app, with no audit entry: a load puts that one back.

### 5.3 A seeded database is refused

Point the load at your usual seeded database. Use your own `DATABASE_URL` from `.env`:

```sh
DATABASE_URL=postgres://gdshub:gdshub@localhost:$DB_PORT/gdshub fixtures npm run migrate:load --; echo "exit code: $?"
```

**Expect:** exit code 1, and a log line `the load was refused, and nothing was written` with reason `seeded_database`. Seed data and migrated data are never mixed, even for a dry run.

### 5.4 A database on another host is refused unless it is named

```sh
DATABASE_URL=postgres://hub:not-a-real-password@hub-db.invalid:5432/hub fixtures npm run migrate:load --; echo "exit code: $?"
```

**Expect:** exit code 2, before anything connects. The message says to use `--database-host`, and doesn't include the password. Naming a different host from the one in `DATABASE_URL` is refused too:

```sh
DATABASE_URL=postgres://hub:not-a-real-password@hub-db.invalid:5432/hub fixtures npm run migrate:load -- --database-host other.invalid; echo "exit code: $?"
```

**Expect:** exit code 2, saying the host doesn't match.

### 5.5 Settings are checked before anything is read

```sh
npm run migrate:inventory -- --data s3://Not_A_Bucket/ --build test/fixtures/migration/hub-build; echo "exit code: $?"
npm run migrate:inventory -- --data src --build test/fixtures/migration/hub-build; echo "exit code: $?"
npm run migrate:verify -- --apply; echo "exit code: $?"
```

**Expect:** exit code 2 each time:

- the S3 address isn't valid
- `src` is inside this repository, so the current Hub's files couldn't be committed by accident
- verify doesn't take `--apply`

### 5.6 Optional: inputs in S3

The S3 code is tested without the network. `inventory-s3.test.ts` checks that the fixtures read from S3 give exactly the same plan as reading them from disk:

```sh
npx vitest run test/unit/migration/storage-s3.test.ts test/unit/migration/aws-s3.test.ts test/unit/migration/inventory-s3.test.ts
```

To try a real bucket, use a private bucket in a non-production AWS account, and only the synthetic fixtures. Never upload the current Hub's files for a test. With your AWS credentials and `AWS_REGION` set in the terminal:

```sh
aws s3 sync test/fixtures/migration/hub-data s3://<bucket>/fixtures/hub-data/
aws s3 sync test/fixtures/migration/hub-build s3://<bucket>/fixtures/hub-build/
npm run migrate:inventory -- --data s3://<bucket>/fixtures/hub-data/ --build s3://<bucket>/fixtures/hub-build/ \
  --site-origin https://hub.example.com --content-selector main --report-dir s3://<bucket>/fixtures/reports/
```

**Expect:** the same summary as step 3.1, and a new report under `s3://<bucket>/fixtures/reports/`. Delete the prefix afterwards.

## 6. Optional: run it on the real Hub

Only if you have a copy of the current Hub's built site and `data/` folder. Ask the developer for it. Keep it outside this repository, and delete it when you've finished.

1. Make a separate database, as in [part 2](#make-a-database-for-the-fixtures), called `gdshub_migration`.
2. Follow [Running it locally](migration.md#running-it-locally) in `migration.md`, with your folders and the current Hub's address in `--site-origin`. Use full paths, or paths starting with `~/`.
3. Check the same things as in part 3:
   - **The inventory:** every kind of input passes.
   - **The dry run:** everything is `created`, the totals match the inventory's records, and nothing is skipped.
   - **Apply, then apply again:** the second run changes nothing.
   - **Verify:** no problems. Check each warning.
4. Look at the pages, as in [part 4](#4-look-at-the-pages), using that database.

The reports from this run name the current Hub's pages and keys. Keep them in `migration-reports/`, which git ignores, and only share counts.

## 7. Troubleshooting

| What you see                                                                                          | What to do                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline` | Something followed `npm run typecheck` on the same line, and `tsc` took it as file names. Run each command on its own, or join them with `&&`                                 |
| `HUB_DATA_DIR (or --data) does not exist: no folder at …`                                             | The path it tried is in the message. Use a full path, or one starting with `~/`. A relative path is read from the repository root                                             |
| `HUB_DATA_DIR (or --data) is not set`, although you gave `--data`                                     | Put `--` between the script name and its options: `npm run migrate:load -- --data …`. Without it, npm keeps the options for itself                                            |
| The load is refused with reason `seeded_database`                                                     | `DATABASE_URL` points at your seeded database. Put the migration database's URL in front of the command                                                                       |
| The load is refused with reason `plan_failed`                                                         | The inventory has validation issues. Run `migrate:inventory` and read its report. On the fixtures, check `.env` has no `HUB_` or `MIGRATION_` settings                        |
| The load is refused with reason `run_in_progress`                                                     | Another load is running against the same database. Wait for it to finish                                                                                                      |
| Exit code 2, mentioning `--database-host`                                                             | `DATABASE_URL` isn't a local database. Check the host and port                                                                                                                |
| Can't connect to the database                                                                         | Check `docker compose up -d db` is running, and that the port in your URL is your `DB_HOST_PORT`, not another Postgres on 5432                                                |
| The fixture counts are different from this guide                                                      | Check `.env` has no `HUB_` or `MIGRATION_` settings, and that you used the `fixtures` function                                                                                |
| `db:reset` refuses, saying the database has imported data                                             | It's refusing to drop migrated data, which is right. `.env` probably points at a migration database. Point it back at your usual one, or drop the migration database (part 8) |
| `npm run dev` shows the seed data, not the migrated data                                              | `npm run dev` doesn't read `.env`. Put `DATABASE_URL=…` in front of it                                                                                                        |
| A page at `/policies/…`, `/guidance/…`, `/whats-new/…` or `/pages/…` shows page not found             | Expected: content page routes come in Phase 6                                                                                                                                 |

## 8. Clean up

```sh
docker compose exec db dropdb -U gdshub gdshub_fixtures
docker compose exec db dropdb -U gdshub gdshub_migration   # if you made one in part 6
rm -f migration-reports/*.json
unset FIXTURES_DB DB_PORT
```

Then uncomment any `.env` settings you commented out in part 2.

`db:reset` refuses databases with migrated data in them, to protect real data, so dropping them is the way to start again.

## 9. What to look at in the code

The handover is in [progress-phase5.md](progress/progress-phase5.md#part-b-loader-redirects-and-verify). For a review, these parts matter most:

| Area                         | Files                                                                                            | What to check                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which database is written to | `src/migration/database-target.ts`                                                               | Only a local database, unless `--database-host` names the host in `DATABASE_URL`. `DATABASE_URL` never appears in messages                            |
| Reading inputs               | `src/migration/storage/`, `src/migration/config.ts`                                              | Local folders outside the repository only. S3 keys must be plain relative paths, and there's a size limit. Credentials come from the environment only |
| Loading                      | `src/migration/loader.ts`, `src/migration/load-mapping.ts`                                       | One transaction with a lock, writes through the repositories only, edited records skipped, nothing deleted except stale links the migration made      |
| Redirects                    | `src/services/redirects/`, `src/middleware/redirect-on-not-found.ts`, `src/db/schema/columns.ts` | Never to another site or the same address, checked in the database and in code. A real page always wins                                               |
| Verify                       | `src/migration/verify.ts`                                                                        | Read-only. The app it starts listens on 127.0.0.1 only. Findings never include values                                                                 |
| No migrated data committed   | `src/migration/check-no-migration-data.ts`, `.githooks/pre-commit`                               | Runs in CI and before every commit                                                                                                                    |

## 10. What to report back

- The exit code and the summary of each step, or the step where something differed from this guide.
- For a problem: the step, the command, and the log line or the report's `code`, `entity` and `key`.
- For the real Hub: counts only.
