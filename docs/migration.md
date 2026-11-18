# Migrating the current Hub

How to move the current Hub's content into the new Hub's database, locally and in AWS. Every manual step is here.

The migration reads 2 inputs and nothing else:

- **The built HTML** (`HUB_BUILD_DIR`): the current Hub's built site
- **The YAML data files** (`HUB_DATA_DIR`): its `data/` folder

Each one can be a local folder or a prefix in an S3 bucket. The old Hub's page sources, Ruby and ERB are never used.

To check the migration works, step by step and without the current Hub's files, see [migration-validation.md](migration-validation.md).

Never commit either input, or anything the migration writes. Reports go to the git-ignored `migration-reports/` folder, or to S3. `npm run check:no-migration-data` runs before every commit (install the hook once with `npm run hooks:install`) and in CI.

## The 3 scripts

| Script                      | What it does                                                                             | Writes                                         |
| --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `npm run migrate:inventory` | Accounts for every built page and data file, and checks every record                     | An inventory report                            |
| `npm run migrate:load`      | A dry run: works out what loading would create, update or skip. With `--apply`, loads it | A load report, and with `--apply` the database |
| `npm run migrate:verify`    | Checks the database and the new pages against the inputs                                 | A verify report                                |

Each script exits with:

- 0 if it passed
- 1 if it failed, or was refused, or the load had to skip records
- 2 if a setting is missing or invalid, or the database isn't one it may use

Logs and reports hold paths, keys, field names, counts and warnings. They never hold content or values.

## Options and settings

Each option overrides its environment variable, which can also go in `.env`.

| Option               | Setting                      | Default                                                                     | Scripts         |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------- | --------------- |
| `--data`             | `HUB_DATA_DIR`               | required. A folder, or `s3://bucket/prefix/`                                | all             |
| `--build`            | `HUB_BUILD_DIR`              | required. A folder, or `s3://bucket/prefix/`                                | all             |
| `--content-selector` | `MIGRATION_CONTENT_SELECTOR` | `main`                                                                      | all             |
| `--strip`            | `MIGRATION_STRIP_SELECTORS`  | none. Comma-separated, added to the defaults in `DEFAULT_STRIP_SELECTORS`   | all             |
| `--site-origin`      | `MIGRATION_SITE_ORIGIN`      | none. The current Hub's addresses: absolute links to them count as internal | all             |
| `--asset-base-path`  | `MIGRATION_ASSET_BASE_PATH`  | `/hub-assets`                                                               | all             |
| `--report-dir`       | `MIGRATION_REPORT_DIR`       | `migration-reports/`. A folder, or `s3://bucket/prefix/`                    | all             |
| `--apply`            | none                         | a dry run                                                                   | `migrate:load`  |
| `--database-host`    | `MIGRATION_DATABASE_HOST`    | none, so only a local database is allowed                                   | load and verify |

The load and verify scripts also use `DATABASE_URL`, as the app does.

Use the same options for all 3 scripts in a run, so they read the inputs the same way.

### Rules the settings must follow

- A local input folder must be outside this repository, and mustn't contain it. The only exception is `test/fixtures/migration/`.
- A local path can start with `~/`, even in `.env`. A relative path is read from the repository root, where `npm run` runs the scripts. If a folder can't be found, the error says which path was tried.
- A report folder inside this repository must be `migration-reports/` or `migration-data/`, which git ignores.
- An S3 address must be `s3://bucket/` or `s3://bucket/prefix/`, with a valid bucket name and plain folder names: no `..`, `?`, `#`, spaces or backslashes.
- `migrate:load` and `migrate:verify` only use a local database (`localhost`, `127.0.0.1`, `[::1]` or `db`) unless `--database-host` names the database's host. It must be exactly the host in `DATABASE_URL`. A `DATABASE_URL` with a `?host=` or `?hostaddr=` parameter is always refused.
- `migrate:load` refuses a database that has ever had the synthetic seed in it, even for a dry run. Seed data and migrated data must never be mixed.

## Running it locally

### 1. Get the inputs

Outside this repository, put:

- a copy of the current Hub's built site, such as `~/hub-migration/hub-build`
- a copy of its `data/` folder, such as `~/hub-migration/hub-data`

### 2. Make an empty database for migrated data

Keep migrated data in its own database, so the seeded database the e2e tests use stays as it is. With the docker compose database running:

```sh
docker compose exec db createdb -U gdshub gdshub_migration
DATABASE_URL=postgres://gdshub:gdshub@localhost:5432/gdshub_migration npm run db:migrate
```

Change the port if your `DB_HOST_PORT` isn't 5432. For the rest of this section, set `DATABASE_URL` to the migration database, for example by putting it before each command, or in your shell.

### 3. Take an inventory

```sh
npm run migrate:inventory -- --data ~/hub-migration/hub-data --build ~/hub-migration/hub-build \
  --site-origin https://<the current Hub's address>
```

Open the report in `migration-reports/`. Every kind of input (`content`, `yaml`, `listing`, `redirect`, `unknown`) must pass. Fix any validation issues in the current Hub's data, then run it again. Items marked `manual_review` don't stop the load: see [Manual review](#manual-review).

### 4. Do a dry run

```sh
npm run migrate:load -- --data ~/hub-migration/hub-data --build ~/hub-migration/hub-build \
  --site-origin https://<the current Hub's address>
```

The load report says what would be created, updated and skipped, and which links would be added or removed. A dry run makes every write and then rolls it all back, so the report is exactly what an apply would do.

### 5. Apply

Run the same command with `--apply`. The whole run is one transaction: if anything fails, nothing is kept. Every write is audited as `system:data_migration`, with the run ID from the report as the request ID.

Run it again whenever the inputs change. A second run with the same inputs changes nothing and adds no audit entries.

### 6. Verify

```sh
npm run migrate:verify -- --data ~/hub-migration/hub-data --build ~/hub-migration/hub-build \
  --site-origin https://<the current Hub's address>
```

Verify starts the app on a random local port against the same database, and checks:

- every record is in the database, with the inputs' values and links
- every page rendered from the YAML has a new page, with the same heading as the old one
- every old address redirects to its new page, and that page exists

Problems fail the check. Warnings need a person to look, but don't fail it:

- a heading that differs from the old page's
- a record or link in the database that the current Hub doesn't have

Redirects to content pages (`/policies/…`, `/guidance/…`, `/whats-new/…` and `/pages/…`) are listed under `waitingForPhase6`. Their pages are in the database, but their routes come in Phase 6.

Then run the app against the migration database (`DATABASE_URL=… npm run dev`) and look at the Phase 4 pages.

### Starting again

`db:reset` refuses a database with migrated data in it. To start again, drop the migration database and go back to step 2:

```sh
docker compose exec db dropdb -U gdshub gdshub_migration
```

## How records are matched, and what is never changed

- Records are matched by their key: tools, instances, capabilities, teams, business units and ownership levels by their YAML key, pages by their slug and redirects by their old address. A tool's contract is the one its placeholder instance links to.
- A record an editor has changed since the migration last wrote it is **skipped**, and listed in the load report. The editor's change is kept, and the load exits with 1 so someone looks.
- **Nothing is ever deleted**, except the links between migrated records (a capability's tools, a team's tools, a business unit's teams) that the migration made and the inputs no longer have. A record in the database but not in the inputs is listed as `onlyInDatabase`, and left alone. Remove it in the database yourself if it should go.
- Fields the inputs don't have are never touched: a tool's vendor, a contract's supplier, a page's owning team, and which instance provides which capability to a team.

## Running it in AWS

Run the same scripts as a one-off ECS task from the app's image, reading the inputs from S3 and writing to RDS. Rehearse on staging first, then do the same on production.

### 1. Put the inputs in S3

Freeze the current Hub, then copy its final build and its `data/` folder to a bucket that only the migration task can read, for example:

```text
s3://<bucket>/frozen/<date>/hub-build/
s3://<bucket>/frozen/<date>/hub-data/
```

Keep the bucket private, encrypted and versioned, with a bucket policy that refuses requests not made over TLS (`aws:SecureTransport`). It holds the current Hub's content, so the same rules apply as for a local copy.

### 2. Give the task permission

The task role needs:

- `s3:ListBucket` on the bucket, limited to the input prefixes
- `s3:GetObject` on the input prefixes
- `s3:PutObject` on a report prefix, such as `s3://<bucket>/reports/`

It needs nothing else in S3. The region comes from `AWS_REGION`, and the credentials from the task role. Never pass AWS keys to the task.

`DATABASE_URL` comes from Secrets Manager, as it does for the app. It must make the connection to RDS use TLS and check the certificate. How the app and the task connect to RDS over TLS is still to be set up (see the backlog), so don't run the migration against RDS until it is.

### 3. Run it

The image runs the compiled scripts, with the same options:

```sh
node dist/migration/scripts/inventory.js --data s3://<bucket>/frozen/<date>/hub-data/ \
  --build s3://<bucket>/frozen/<date>/hub-build/ --site-origin https://<the current Hub's address> \
  --report-dir s3://<bucket>/reports/

node dist/migration/scripts/load.js <the same options> --database-host <the RDS host>
node dist/migration/scripts/load.js <the same options> --database-host <the RDS host> --apply
node dist/migration/scripts/verify.js <the same options> --database-host <the RDS host>
```

Always give `--report-dir` as an S3 address in AWS. The task's disk is lost when it stops, and the image's `/app` folder isn't writable.

Before the `--apply` run, take an RDS snapshot.

### Rolling back

Restore the RDS snapshot taken before `--apply`. The audit log is append-only, so the migration can't be undone by deleting rows.

## Manual review

The inventory report lists every item that needs a person, with `status: "manual_review"` and its warnings. They are of 3 kinds:

- **Pages converted with warnings**, for example a table markdown can't show, kept as HTML. They are loaded as converted. Check each new page once it renders (Phase 6), and fix it in the new Hub.
- **Items with nothing to load**: a data file the migration doesn't know, a listing with no replacement page, or a redirect page that goes to another site. Decide with the content owner whether each is still needed. A redirect to another site can be recreated in CloudFront if it is.
- **Data warnings**, for example a value that couldn't be stored or a repeated key. Fix them in the current Hub's data, or agree to accept them.

To agree the list:

1. Take the items from the inventory report (paths, keys and warnings only).
2. Go through them with each content owner.
3. Record what was agreed outside this repository. Decisions name content, so they don't belong here.
4. Fix what can be fixed in the inputs, and run the inventory again until only agreed items are left.

## Cut-over checklist

1. Check the migration task connects to RDS over TLS, and reads inputs only from the private input bucket.
2. Rehearse every step on staging, and check the Phase 4 pages there.
3. Agree the manual-review list with content owners.
4. Freeze the current Hub: no more changes.
5. Copy its final build and data files to S3.
6. Run `migrate:inventory`. Every kind of input passes.
7. Run `migrate:load` as a dry run. The report shows only what you expect.
8. Take an RDS snapshot.
9. Run `migrate:load --apply`. It exits 0.
10. Run `migrate:verify`. It passes, and every warning has been checked.
11. Check the new Hub's pages, and that old addresses redirect.
12. Point the old Hub's address at the new Hub.
13. Turn on editing.
14. Keep the frozen inputs and the reports until the new Hub has been signed off.
