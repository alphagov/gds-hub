# Phase 8: Web editing in unauthenticated test mode

**Date:** 2026-11-25

**Status:** code complete, with the JWT checks from the plan still to do (see "The CLAUDE.md exception"). `npm run lint`, `npm run typecheck`, `npm test` (Vitest, including the integration tests), `npm run test:e2e` (Playwright, with and without JavaScript, including axe) and `npm run check:no-migration-data` all pass in the sandbox. The tests were written first and agreed with the developer. Nothing needs running on the host except the steps below.

Branch: `DX-322/phase8-web-editing` (from `main`).

## Why this exists

The developer wants to release something to the cloud environment before Phase 7 (sign-in and roles) is delivered. So Phase 8's editing is built **without verifying the Lambda@Edge JWT**. Editing works in an explicit **test mode**: every edit page shows that nobody is signed in, and every audit row is marked as unverified. The identity check is one swappable seam, so the real JWT check (or Phase 7) can be plugged in later by adding a provider and changing one config value.

## The CLAUDE.md exception

This deliberately goes against the Identity rule in `CLAUDE.md` that `/edit/*` must verify the JWT. The developer chose to leave `CLAUDE.md` as it is. The plan's JWT items for Phase 8 are **not done** and are follow-ups:

- Edit requests without a token, or with no email in it, are refused.
- Edit requests with a forged, wrongly signed, expired or wrong-audience token are refused (tests sign tokens with keys generated during the test run).
- The editor's email, from the verified token, is recorded in the audit log.

Until then, anyone who can reach the app can edit when `EDIT_MODE=test`. It is off by default.

## Done when (from `docs/build-plan.md`)

| Item                                                                 | Result                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Every entity supports create, update and delete in the browser       | Partly met: five kinds of record (see "What was built"). The rest are in `docs/backlog.md`. |
| Each change produces an audit row recording the editor's email       | Not met by design: the row records `system:unauthenticated_test_mode`, marked unverified.   |
| Error states pass axe                                                | Met, with and without JavaScript.                                                           |
| Requests without a token, or with no email, are refused              | Not met by design (no token is read). Follow-up.                                            |
| Forged, wrongly signed, expired or wrong-audience tokens are refused | Not met by design (no token is read). Follow-up.                                            |

## What was built

- **Off by default.** `EDIT_MODE` is `off` (the default, and what a blank value means) or `test`. Any other value stops the app starting. When off, every `/edit/*` request gives page not found.
- **An identity seam** (`src/editing/editor-identity.ts`). `requireEditor(provider)` asks the provider on every request, puts the editor on `res.locals.editor` with the request's ID on their actor, refuses a request the provider can't identify with a 403, and passes a provider's failure on as a 500.
- **Test mode** (`src/editing/test-mode.ts`). The provider gives the fixed system actor `system:unauthenticated_test_mode` and `verified: false`. Nothing a person types is recorded as an identity. Every page rendered for an unverified editor, including error pages, shows a warning banner (`layout.editNotice`, set in `src/lib/render.ts`).
- **Editing pages** for pages, tools, instances, vendors and products, teams and services (`services` in addresses): `GET /edit`, `/edit/:entity`, `/edit/:entity/new`, `/edit/:entity/:id` and `/edit/:entity/:id/delete`, with `POST` to the first, third and fourth of those and to the delete address. They use GOV.UK Frontend macros, post normally (so work without JavaScript), show the error summary with the typed values kept, and redirect with a 303 after a save.
- **Configuration-only entities** (`src/editing/entities.ts`). Each kind of record is a list of fields with a kind, label, hint and shared Zod schema. The form parser, the edit service, the presenter and the templates all read it.
- **Form parsing** (`src/editing/form.ts`). Reads only the entity's own fields, rejects a repeated value, never puts typed text in an error message, trims text, keeps markdown as typed (apart from line endings), and doesn't read a slug on update. On create it copies the slug to `key` for tools, instances and services.
- **Edit service** (`src/services/editing/edit-service.ts`) over the repositories, so every write creates its audit entry in the same transaction.
- **Lost-update protection.** The form sends back `updatedAt`. `WriteOptions.expectedUpdatedAt` makes a repository update throw `RepositoryError("stale")` (checked after the row is locked, even if nothing would change). The page gives a 409, keeps what was typed and links to the latest version.
- **Cross-site writes are refused** with a 403 (`src/editing/cross-site.ts`): `Sec-Fetch-Site` other than `same-origin` or `none`, or, when it is missing, an `Origin` that doesn't match the `Host`.
- **Every `/edit/*` response is `Cache-Control: no-store`**, including redirects and errors. The middleware is mounted on `/edit` only, so readers and old-address redirects are unaffected.
- **Other results:** invalid input gives 400, a duplicate 400, a delete of a record in use 409, a missing record 404, a body that isn't form data 400 and a database failure the 500 page without the values.
- **Docs:** `docs/editing.md` (how it works, how to add a kind of record, how to replace test mode) and a README section.

## Key files

- `src/editing/`: `editor-identity.ts`, `test-mode.ts`, `entities.ts`, `form.ts`, `cross-site.ts`
- `src/services/editing/edit-service.ts`
- `src/routes/edit.ts`, `src/presenters/edit.ts`
- `views/edit/` (index, list, form, delete), `views/partials/edit-notices.njk`, and the notice in `views/layouts/base.njk`
- `src/repositories/repository.ts` (`expectedUpdatedAt`) and `errors.ts` (`stale`)
- `src/config.ts` (`EDIT_MODE`), `src/app.ts` (optional `editing` dependency), `src/server.ts` (builds it and logs a warning at start)
- `src/validation/catalogue.ts` (`vendorFields`)
- Tests: `test/unit/editing/`, `test/integration/edit-service.test.ts`, `test/integration/stale-update.test.ts`, `test/e2e/editing.spec.ts`, and the edit pages in `test/e2e/accessibility.spec.ts`

## Decisions

- **No name field and a fixed actor,** so nothing typed by a user is recorded as an identity. The audit row says the change is unverified.
- **Saves publish straight away** (no draft workflow), as the plan says. A page's `status` is on the form, and a new page starts as a draft so it isn't shown by accident.
- **A slug can't be changed after it is created,** because it forms the record's address and old links would break.
- **The warning is rendered by the layout** from `res.locals.editor`, so every page an unverified editor sees carries it, including 403/404/409/500 pages, without each route remembering to.
- **Pages with an error summary** start their document title with `Error: `, using a new `hasError` flag on `PageViewModel` and an argument to `documentTitle`, per the GOV.UK pattern.
- **Two changes to tests the developer reviewed,** both because the page behaves differently from what the test assumed: the index test looks for links inside `main` (Tools and Services are also in the service navigation), and the error summary test checks the field has focus when JavaScript is on (GOV.UK Frontend moves focus and doesn't change the address). The edit route tests also set a longer timeout, because some tests start a new app for each request, and one test was added for addresses outside `/edit`.
- **Seeded pages have no `publishedAt`** when saved through the form, because it isn't on the form (as planned). Nothing reads it yet.

## Steps to run on the host

```sh
docker compose up -d db
npm run db:migrate
npm run db:seed
EDIT_MODE=test npm run dev
# open http://localhost:3000/edit
```

Add `EDIT_MODE=` (blank, meaning off) to `.env.example` by hand: the sandbox can't edit that file. For the cloud environment, set `EDIT_MODE=test` on the ECS service only when access is limited (the WAF IP allow-list). The Terraform doesn't set it.

## Blockers and missing packages

No packages are missing. No blockers.

## Follow-ups

- **Verify the JWT (Phase 8, still to do).** Add a provider that checks the signature, `exp`, `iss` and `aud`, reads the email and returns `verified: true`, then choose it in `src/server.ts`. Add tests with tokens signed by keys generated during the test run, and the audit email checks. See `docs/editing.md`.
- Add `EDIT_MODE` to `.env.example` (see above).
- Not in this release, logged in `docs/backlog.md`: an "Edit this page" link on the read pages, editing links between records (a tool's capabilities, a team's instances, business units), instance `extraAttributes`, contracts, suppliers, capabilities, business units, ownership levels and redirects, and previewing before saving (Phase 9).
