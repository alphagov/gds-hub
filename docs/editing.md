# Editing in the browser

Editors add, change and delete records at `/edit`. This page explains how that is put together, how to add a kind of record, and how to replace test mode when sign-in is ready.

## How it works

- `GET /edit` lists the kinds of record. `/edit/:entity` lists one kind, `/edit/:entity/new` and `/edit/:entity/:id` show the form, and `/edit/:entity/:id/delete` asks for confirmation. Each form and each delete posts back to the same address.
- Every response is `Cache-Control: no-store`.
- A browser write that comes from another site is refused (`src/editing/cross-site.ts`).
- `src/editing/form.ts` reads the form, using the shared Zod schemas in `src/validation/catalogue.ts`, and gives either the values to save or a list of problems. Error messages never repeat what was typed.
- `src/services/editing/edit-service.ts` reads and writes through the repositories, so every write creates its audit entry in the same transaction.
- The form sends back when the record was loaded (`updatedAt`). If the record has changed since, the save is refused with a 409 and nothing is written (`RepositoryError("stale")`).
- A slug can be set when a record is added and can't be changed, because it forms the record's address.

## Test mode

`EDIT_MODE=test` switches editing on without checking who is editing (`src/editing/test-mode.ts`). Everyone is the system actor `system:unauthenticated_test_mode`, which is recorded in `audit_log.actor_name` and `actor_subject`. Nothing a person types is recorded as their identity. Every edit page shows a warning while the editor is not verified.

This does not meet the Identity rule in `CLAUDE.md`, which says every `/edit/*` route must verify the Lambda@Edge JWT. It is a deliberate exception so editing can be released before sign-in is delivered. The JWT checks are still to do (see the Phase 8 handover).

## Add a kind of record

Add an entry to `EDIT_ENTITIES` in `src/editing/entities.ts`:

1. Add the key to `EditEntityKey`, and the repository's name to `EditRepositoryName` if it is new.
2. Give the entry `singular`, `plural`, `description`, `repository`, `titleField` and `fields`. Each field has a `kind`, the column's `name`, a `label` and a `schema` (reuse the one in `src/validation/catalogue.ts`).
3. Set `keyFromSlug: true` if the table also has a `key` column that should match the slug.

The forms, routes, templates, service and index page read this entry, so no other code changes. The repository must exist in `src/repositories/index.ts` and be listed in `EditRepositories`. Add the new kind to the edit pages in `test/e2e/accessibility.spec.ts`.

## Replace test mode with a verified provider

Who is editing is decided in one place, an `EditorIdentityProvider` (`src/editing/editor-identity.ts`). `src/server.ts` chooses the provider:

```ts
const editing = { identity: createTestModeIdentity(), service: createEditService(...) };
```

To verify editors:

1. Write a provider whose `identify(req)` verifies the Lambda@Edge JWT (the signature against the public key, then `exp`, `iss` and `aud`) and returns `{ actor: createActor({ email }), verified: true }`. It must reject or return `undefined` for anything it can't verify, and must not rely on the load balancer being unreachable directly. `undefined` gives a 403 and a rejection gives the 500 page.
2. Choose it in `src/server.ts`, for example from a new `EDIT_MODE` value (add it to `src/config.ts` and its tests).
3. Test it with tokens signed by keys generated during the test run.

When `verified` is true the test mode warning is not shown, and the request's ID is added to the actor for the audit log.
