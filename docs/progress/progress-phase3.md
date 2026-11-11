# Phase 3: Repositories and audit service

**Date:** 2026-11-11

**Status:** code complete. The sandbox has no Node.js, so the code was written without running anything. The developer ran lint, typecheck and the tests on the host, the errors were fixed, and the checks are green.

## What was built

- A generic, typed repository for each of the 15 data tables, made by `createRepository(table, entityType)`.
- Every create, update and delete:
  - runs in a transaction
  - locks and reads the record as it was before
  - makes the change and sets `updated_at`
  - works out which fields changed
  - adds an `audit_log` entry in the same transaction
- Updates that change nothing write nothing: no audit entry, and `updated_at` stays the same.
- The `Actor` type (`{ email, requestId? }`), `createActor` for editors and `systemActor("data_migration")` for the migration.
- The audit service: `historyFor`, `recentChanges` and `lastUpdated`.
- Typed read models for the tool and instance detail pages, with the records linked to them.
- `RepositoryError`, which reports database errors without the values involved.
- A lint rule that stops anything outside `src/repositories` and `src/db` importing the database layer, `drizzle-orm` or `pg`, with a test that runs the real rule.
- The `audit_log.source_ip` column was removed, and the migrations were squashed into a fresh baseline (see [Decisions](#decisions)).

## Key files

```
src/repositories/repository.ts       createRepository, Repository<T> and the write/audit logic
src/repositories/audit-log-repository.ts   recordAuditEntry (inside a write) and the audit log reads
src/repositories/catalogue-read-repository.ts  getToolDetail, getInstanceDetail
src/repositories/read-models.ts      ToolDetail, InstanceDetail and their parts
src/repositories/errors.ts           RepositoryError, toRepositoryError
src/repositories/executor.ts         Executor, runInTransaction (savepoints), runReadOnly (snapshot)
src/repositories/index.ts            Repositories, createRepositories, connectRepositories, re-exported types
src/services/audit/actor.ts          Actor, createActor, systemActor, assertValidActor, ActorError
src/services/audit/changes.ts        valuesEqual, changedFields (pure)
src/services/audit/audit-service.ts  createAuditService: historyFor, recentChanges, lastUpdated
eslint.config.js                     no-restricted-imports for the database layer
test/unit/actor.test.ts, audit-changes.test.ts, repositories.test.ts, data-access-imports.test.ts
test/integration/repositories.test.ts, audit-service.test.ts, read-models.test.ts
```

## Repository API

Services and routes import everything from `src/repositories/index.ts`. They can't import `src/db`, `drizzle-orm` or `pg` (lint).

```ts
createRepositories(db: Database): Repositories
connectRepositories(databaseUrl: string): { repositories: Repositories; close(): Promise<void> }

interface TransactionRepositories {
  vendors, suppliers, tools, supplierTools, contracts, ownershipLevels, instances,
  capabilities, capabilityTools, productTeamServices, productTeamServiceInstances,
  instanceCapabilities, businessUnits, businessUnitProductTeamServices, pages: Repository<typeof table>
  auditLog: AuditLogRepository        // read only
  transaction<R>(work: (repositories: TransactionRepositories) => Promise<R>): Promise<R>
}

interface Repositories extends TransactionRepositories {
  catalogue: CatalogueReadRepository  // read models: on the pool only, not inside transaction()
}

interface Repository<T> {
  entityType: EntityTypeOfTable<T>                    // e.g. "tool"
  list(options?: { limit?; offset? }): Promise<RecordOf<T>[]>   // name (or title) order, then id
  getById(id: number): Promise<RecordOf<T> | undefined>
  getBySlug(slug: string): Promise<RecordOf<T> | undefined>      // only on tables with a slug or key
  create(values: NewRecord<T>, actor: Actor, options?: { changeSummary? }): Promise<RecordOf<T>>
  update(id: number, changes: RecordChanges<T>, actor: Actor, options?: { changeSummary? })
    : Promise<{ record: RecordOf<T>; changedFields: readonly string[] }>
  remove(id: number, actor: Actor, options?: { changeSummary? }): Promise<RecordOf<T>>
}

createRepository<T>(table: T, entityType: EntityTypeOfTable<T>): (executor: Executor) => Repository<T>

createAuditService(repositories): {
  historyFor(entityType, entityId, { limit? }): Promise<AuditEntry[]>   // newest first; default 50, max 500
  recentChanges({ limit?, entityTypes? }): Promise<AuditEntry[]>         // newest first; default 20, max 100
  lastUpdated(entityType, entityId): Promise<{ at: Date; by: string; action } | undefined>
}

repositories.catalogue.getToolDetail(slug): Promise<ToolDetail | undefined>
repositories.catalogue.getInstanceDetail(slug): Promise<InstanceDetail | undefined>
```

- **Types:** `RecordOf<T>` is the table's select type. `NewRecord<T>` is its insert type without `id`, `createdAt` and `updatedAt`. `RecordChanges<T>` is a partial `NewRecord<T>`.
- **Managed fields:** `id`, `createdAt` and `updatedAt` are removed from caller input at runtime too, along with fields the table doesn't have.
- **`getBySlug`:** uses the `slug` column, or `key` on tables without one (capabilities, ownership levels, business units), the same rule as the `search_index` view. It isn't on suppliers, contracts or the join tables, and calling it there is a compile error.
- **`update`:** an empty `changedFields` means nothing changed and nothing was written.
- **`transaction`:** writes inside it are kept or rolled back together. Each write also has its own savepoint, so a caller can catch a failed write (for example a duplicate slug) and carry on. The repositories it gives don't include `catalogue` (see [Read models](#read-models)).
- **`remove` and join tables:** the database deletes join-table rows with the record they link (ON DELETE CASCADE), which would leave them with no audit entry. So `remove` first removes each of those rows through its own repository, with a "delete" entry whose change summary is "Removed with supplier 12" (for example). If the record itself can't be removed (`in_use`), nothing is removed. The tables are found from the schema's foreign keys. If a cascading table ever has no repository, removal is refused rather than deleting rows without an audit entry.

### Errors

Writes and reads throw `RepositoryError` with:

- `entityType`
- `constraint`, when the database names one
- `kind`, which is one of:

| `kind`              | When                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| `not_found`         | `update` or `remove` on an id that doesn't exist                                  |
| `duplicate`         | a unique constraint, for example `vendors_slug_unique`                            |
| `in_use`            | removing a record another record still links to (RESTRICT)                        |
| `invalid_reference` | creating or updating a record that links to one that doesn't exist                |
| `invalid_value`     | a check or not-null constraint, or a bad value (for example a `javascript:` link) |
| `failed`            | anything else                                                                     |

The message never includes the values written. Drizzle's own error, which includes the query parameters, is kept only as `cause`, and the logger doesn't write `cause`. Phase 8 can map `kind` and `constraint` to form errors.

An invalid actor throws `ActorError` before anything is written. A bad `limit` or `offset` throws `RangeError`.

## How an Actor is built

```ts
interface Actor {
  readonly email: string;
  readonly requestId?: string;
}
```

- **Editors (Phase 8):** `createActor({ email, requestId })`.
  - `email` is the email claim from the verified Lambda@Edge JWT. Never decode the token without verifying it.
  - `requestId` is `res.locals.requestId`.
  - The email is trimmed, lower-cased and checked: it must look like an email address and be at most 255 characters.
  - Anything starting with `system:` is refused, so a token can't pose as a system actor.
- **The data migration (Phase 5):** `systemActor("data_migration")` gives `system:data_migration`.
- **Every write checks the actor again** with `assertValidActor`, in case it was built by hand. It accepts an editor's email address or a known system actor.
- **Storage:** the email is stored as both `actor_name` and `actor_subject`, and the request ID as `request_id`.
- **No IP address is recorded.** The WAF allow-list already decides who can reach the Hub.

## Audit entries

| Action   | `before`    | `after`     | `changed_fields`                    |
| -------- | ----------- | ----------- | ----------------------------------- |
| `create` | null        | full record | every field                         |
| `update` | full record | full record | fields that differ, not `updatedAt` |
| `delete` | full record | null        | every field                         |

- `before` and `after` use the code's camelCase field names, as the seed does (confirmed by the developer). Dates are ISO 8601 strings.
- The record is locked (`SELECT … FOR UPDATE`) before it is read. Concurrent updates take turns, and each entry's `before` is the value it actually replaced.
- **When a change happened:** `clock_timestamp()` is read after the lock is taken, to the millisecond, and stored as both the record's `updated_at` (and `created_at` on a create) and the audit entry's `created_at`. `now()` isn't used because it's the transaction's start time: a transaction that started earlier but changed the record later would date its change before one it actually replaced, and history would show the wrong change as the latest.
- **What counts as a change:** fields are compared as the database stores them. Null and missing are the same, dates compare by time, jsonb objects ignore key order, and lists compare in order. The repository checks the requested values before writing. It then checks the stored row again and rolls back if the database stored the same values.

## Read models

Each is loaded from the pool in its own read-only `REPEATABLE READ` transaction, so the record and everything linked to it come from one consistent snapshot. `catalogue` isn't offered inside `repositories.transaction()`: that transaction is READ COMMITTED (as writes need), where each query can see different committed data, and its isolation can't be raised once it has run a query.

- **`ToolDetail`**, shaped after the current Hub's tool page:
  - `tool`
  - `vendor`, or null
  - `suppliers`
  - `contracts`, newest start date first, each with its `supplier`: dates, cost model, commercials, data protection, number of users
  - `capabilities`, by position, then name
  - `instances`, each with `ownershipLevel` and `targetOwnershipLevel`, including the placeholder instance (`isPlaceholder`) that holds the tool's own properties
  - `productTeamServices`: each team using any of the tool's instances, listed once, with its `businessUnits` so Phase 4 can group them
- **`InstanceDetail`:**
  - `instance`
  - `tool`
  - `contract` and its supplier, or null
  - `ownershipLevel` and `targetOwnershipLevel`
  - `productTeamServices` (with `businessUnits`)
  - `capabilities`, each with the team it is provided to

Contracts are shown to everyone, as on the current Hub (developer's decision). They stay out of the search index.

## Decisions

- **Only repositories touch the database.** `no-restricted-imports` in `eslint.config.js` covers `src/**` except `src/repositories/**` and `src/db/**`. It catches type-only imports and re-exports too, but not dynamic `import()`. Tests can still use the database directly.
- **The repositories use two pure modules from `src/services/audit`.** These are `actor.ts` and `changes.ts`, and neither has any database access.
- **One cast restores the table's types.** Drizzle can't infer row types for a table chosen at runtime. So the shared write logic works with plain rows, and `createRepository` restores each table's types in a single documented cast. The public API is fully typed, and `entityType` is checked against the table when compiling and at runtime.
- **`audit_log.source_ip` was dropped** (developer's decision).
  - **Why:** it was never written and would only have held addresses the WAF already lets through.
  - **Migration rule:** nothing was deployed and no database but the developer's local one existed, so the column was removed by squashing the migrations (below) rather than adding a migration to drop it.
  - **Test:** a schema test checks that no table has an IP address column.
- **The migration's actor is `system:data_migration`,** not `system:import` (developer's decision), so it's clear to people who weren't part of the rewrite. The `db:reset` guard still refuses any `system:` entries other than the seed's.
- **Ordering:**
  - **History:** newest first by `created_at`, then by `id`. Writes in one transaction share `created_at`, so `id` keeps them in the order they were made.
  - **`list()`:** by `name` (or `title` for pages), then `id`.
- **Limits:**
  - `historyFor` defaults to 50 entries, capped at 500.
  - `recentChanges` defaults to 20, capped at 100.
  - A limit that isn't a positive whole number is refused.
- **`lastUpdated` reads the audit log, not `updated_at`,** so it can also say who made the change.
- **Changes from code review** (all confirmed and fixed, each with a test that fails without the fix):
  - Change times come from `clock_timestamp()` after the lock, not `now()`, so history is in the order changes were made.
  - Read models are only loaded from the pool, in their own snapshot, and not inside write transactions.
  - Join-table rows deleted with a record are removed and audited explicitly first.
- **The migrations were squashed into a fresh baseline** (developer's decision).
  - **Why:** nothing has been deployed and the developer's local database was the only one. CI creates a new database on every run.
  - **What changed:** `drizzle/` was regenerated: `0000_init` from the current schema (so it has no `source_ip`), then the hand-written `0001_search` and `0002_audit_log_append_only` registered again with `drizzle-kit generate --custom`, unchanged.
  - **Local databases:** existing ones have the old migration history. Rebuild them with `npm run db:reset` (or `docker compose down -v`).
  - **Don't do this again.** Once any database exists that isn't disposable (a shared environment, staging or production), migrations are append-only and follow expand then contract.

## Steps to run on the host

```sh
docker compose up -d db

# Squash the migrations into a fresh baseline (done once, in this phase).
# Keep the two hand-written migrations first.
cp drizzle/0001_search.sql drizzle/0002_audit_log_append_only.sql /tmp/
rm -rf drizzle
npm run db:generate -- --name=init
# drizzle-kit writes a stub for each custom migration, so put each file back.
npx drizzle-kit generate --custom --name=search
cp /tmp/0001_search.sql drizzle/0001_search.sql
npx drizzle-kit generate --custom --name=audit_log_append_only
cp /tmp/0002_audit_log_append_only.sql drizzle/0002_audit_log_append_only.sql

# Rebuild the local database (it has the old migration history) and run the checks
npm run db:reset
npm run format     # Prettier couldn't run in the sandbox
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

`drizzle/meta/_journal.json` lists exactly `0000_init`, `0001_search` and `0002_audit_log_append_only`, and `0000_init.sql` has no `source_ip`. Commit `drizzle/` including `meta/`.

## Blockers and missing packages

- No Node.js in the sandbox (the developer chose not to install it), and `node_modules` only has macOS native bindings, so Vitest can't start in the sandbox anyway. Nothing was run in the sandbox. The developer ran every check on the host.
- No packages are missing.

## Follow-ups

- Phase 8: build the Actor from the verified JWT (see above). Turn `RepositoryError` kinds into form errors. Consider an "expected `updatedAt`" check on update, so a second editor can't silently overwrite a change they haven't seen (backlog).
- Phase 11: show `historyFor` and `lastUpdated`. View models mustn't expose `requestId`.
- The seed still writes its own audit entries with `actor_name` "Seed script". Moving it onto the repositories would make all entries consistent (backlog).
- `publish` and `unpublish` audit actions aren't written yet. Saves publish straight away in the MVP (backlog).
