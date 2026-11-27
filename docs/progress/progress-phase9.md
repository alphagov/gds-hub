# Phase 9: Preview

**Date:** 2026-11-27

**Status:** code complete. `npm run lint`, `npm run typecheck` and `npm test` (Vitest, including the integration tests) pass in the sandbox. `npm run test:e2e` passes in the sandbox against the `gdshub_e2e_seed` database (see "Steps to run on the host"). Nothing needs running on the host except the steps below.

Branch: `DX-323/phase9-preview` (from `main`).

## Done when (from `docs/build-plan.md`)

| Item                                 | Result                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| Preview never writes to the database | Met. Tests count rows and audit entries before and after a preview. |
| A tampered payload is rejected       | Met. Unit, integration and Playwright tests cover it.               |

## What was built

- **A Preview button on every edit form,** next to Save. It posts the typed values to `/edit/:entity/preview` (or `/edit/:entity/:id/preview` for an existing record). The form checks run first, so a form with mistakes shows the error summary and keeps what was typed.
- **The preview is the real page.** It is built from the same details as the reader's page (a vendor, tool, instance, service or content page), with the typed values in place of the saved ones and everything else as saved. A page whose type has no reader section yet is shown in the nearest section, with a note that readers can't see it.
- **A banner on the preview** (`page.preview` in `PageViewModel`, drawn by `views/layouts/base.njk`) says nothing is saved and offers two buttons: save and publish, or continue editing. Both send back a signed payload in a hidden field. A preview page also carries `noindex, nofollow`, in a meta tag and an `X-Robots-Tag` header.
- **Save and publish** (`/publish`) checks the payload, parses the values again with the same form checks, then saves through the normal edit service, so the audit entry is written in the same transaction as before. **Continue editing** (`/continue`) shows the form again with what was typed.
- **A payload that can't be used** (missing, changed, expired, or made for another actor or record) shows a problem page (`views/edit/problem.njk`) with a 400, and nothing is read from it.
- **A choice that has gone is a form error, not a 500.** If a vendor, tool or owning team chosen in the form was deleted after it opened, or a changed tool would leave an instance with a contract for another tool (which saving refuses too), the form is shown again with a 400 and what was typed.
- **The save button says "Save draft"** for a page whose status is draft, because saving it doesn't publish it.
- **Preview only reads.** The preview service uses the catalogue and content services and the edit service's read side. It has no write path.
- **A new setting,** `PREVIEW_SIGNING_SECRET` (at least 32 characters), is needed when `EDIT_MODE=test`. The app won't start without it. `docker-compose.yml` passes it through to the container.
- **The edit warning** is now GOV.UK warning text, so it is not confused with the preview banner, which is a notification banner.

## Key files

- `src/editing/preview-signing.ts`: the signing helper (`createPreviewSigner`, `PreviewSigner`)
- `src/services/editing/preview-service.ts`: builds the details a preview shows
- `src/presenters/preview.ts`: the preview page, its banner and the problem page
- `src/routes/edit.ts`: the `preview`, `publish` and `continue` routes, and the save helpers shared with the normal save
- `views/layouts/base.njk`, `views/edit/form.njk`, `views/edit/problem.njk`
- `src/view-models.ts` (`PreviewViewModel`, `EditProblemViewModel`), `src/config.ts`, `src/app.ts`, `src/server.ts`, `docker-compose.yml`
- Tests: `test/unit/editing/preview-signing.test.ts`, `test/unit/editing/preview-routes.test.ts`, `test/unit/editing/preview-service.test.ts`, `test/unit/editing/edit-routes.test.ts`, `test/unit/config.test.ts`, `test/integration/preview.test.ts`, `test/e2e/preview.spec.ts`

## Decisions

- **The preview carries the typed text, not parsed values.** The hidden field holds what the editor typed, as text, so "continue editing" gives the form back exactly as it was.
- **The signature shows who made the payload, not that it is valid.** The values are parsed again with the same form checks when they are saved, so a payload can never skip validation.
- **A payload is tied to one actor and one record.** It names the kind of record, the record's id (none for a new record), the actor's email and when it was made. A payload made for one actor or record is refused for another. In test mode every editor is the same actor, so a copied payload works for anyone until the JWT provider arrives.
- **A payload lasts 30 minutes** (`PREVIEW_LIFETIME_MINUTES`), with a minute of allowance for clocks that differ between servers. After that the editor starts again from the form.
- **The lost-update check still applies.** The payload keeps the time the form was loaded, and the save uses it, so saving from a preview over someone else's newer change gives the same 409 as the normal form.
- **The payload is signed, not encrypted.** It holds only what the editor already typed. Don't put anything secret in an edit form.
- **The secret comes from the environment.** `PREVIEW_SIGNING_SECRET` is never written to a file. Playwright makes a new one for each run.
- **The edit warning changed to warning text,** so the preview's notification banner is the only banner on a preview page.

## Steps to run on the host

```sh
docker compose up -d db
npm run db:migrate
npm run db:seed
# Make your own secret, at least 32 characters, and keep it out of git
PREVIEW_SIGNING_SECRET=$(openssl rand -hex 32) EDIT_MODE=test npm run dev
# open http://localhost:3000/edit, change a record and choose Preview
```

For `npm run test:e2e`, use the `gdshub_e2e_seed` database by setting `DATABASE_URL` for that command, not your general development database, which won't match the synthetic seed. The migrated-content specs use `gdshub_e2e_migrated`, which the tests create themselves.

If `db:migrate` or `db:seed` stops with "PREVIEW_SIGNING_SECRET: needed when EDIT_MODE is test", your shell has `EDIT_MODE=test` set. Run them with `EDIT_MODE=` in front.

## Blockers and missing packages

No packages are missing. No blockers.

## Follow-ups

- **Phase 8 (still to do):** the JWT provider. When it arrives, previews are tied to the verified email instead of the test-mode actor, with no change to the signing helper.
- **Phase 13:** set `PREVIEW_SIGNING_SECRET` for the ECS service from Secrets Manager. The Terraform doesn't set it, so editing in the cloud won't start until it does.
- **Scripts:** `db:migrate` and `db:seed` read the whole app config, so they need the preview secret when `EDIT_MODE=test` is set. They could skip that check. Logged in `docs/backlog.md`.
- **Left for later (in `docs/backlog.md`):** relative links in a content preview, a bigger body limit for the save and continue routes, and changing the tool of an instance that has a contract.
