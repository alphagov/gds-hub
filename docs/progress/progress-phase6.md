# Phase 6: Content pages (policies and service guidance)

**Status:** code complete on 2026-11-24. Lint, typecheck, Vitest and Playwright (in the sandbox) pass, and `check:no-migration-data` passes. The tests were written first and agreed with the developer.

## What was built

- **Routes:** `/policies`, `/policies/:slug`, `/guidance` and `/guidance/:slug`. `/services/:slug` gains a "Guidance" section listing the team's published service guides.
- **Only published pages are shown.** The filter is in every query in the content repository, so a draft can't reach a route. A draft, a page of another type (for example a guide under `/policies`), an unknown slug and a malformed slug all give the page not found page, and the redirect lookup still runs after that.
- **Page types by route:**

  | Route       | Page types                  |
  | ----------- | --------------------------- |
  | `/policies` | `policy`                    |
  | `/guidance` | `guidance`, `service_guide` |

  `general` and `whats_new` pages have no route yet (see [follow-ups](#follow-ups)).

- **Page template:** the title, the summary as the lead paragraph, a summary list (Owner, Contact, Last reviewed), an "On this page" list of links to the h2 headings and the body. Owner links to the owning team when the page has one. Contact is a `mailto:` link when it's a plain email address, otherwise text. Empty Owner and Contact rows are left out, and Last reviewed shows "Not recorded" when there's no date (migrated pages have none). The list is called "On this page" because the left-hand navigation is already "Contents", and two navigation landmarks with the same name fail axe.
- **Seed:** `software-approval` has several h2s, a list, a link and a table. A new redirect sends `/InfoSec/software-approval.html` to `/policies/software-approval`.

## Markdown helper API

`src/lib/markdown.ts`:

```ts
renderMarkdown(markdown: string): { html: SafeHtml; headings: { id: string; text: string }[] }
```

1. `marked` (GitHub-flavoured, raw HTML allowed because migrated pages keep some, such as tables).
2. `sanitize-html` with an allow-list: headings, paragraphs, lists (an `ol` keeps a whole-number `start`), links, images, tables (with `caption`, and `scope`, `colspan` and `rowspan` on cells), definition lists, `details` and `summary`, `pre`, `code`, `blockquote`, `strong`, `em`, `del`, `sub`, `sup`, `kbd`, `hr`, `br`. Everything else is dropped (including `script`, `style`, `iframe`, `form`, `svg`, `math` and comments). Every `class`, `id`, `style` and `on*` attribute is removed. Links keep `http`, `https`, `mailto`, `tel` and relative addresses. Image `src` keeps `https` and relative addresses.
3. A `cheerio` pass over the sanitised output only. It unwraps a link left with no address into plain text, removes an image left with no source and a heading with no text, and makes a body h1 an h2 (the page has its own). It adds `scope="col"` to the header cells of a markdown table, GOV.UK classes (h2 `govuk-heading-m`, h3 and below `-s`, `govuk-body`, `govuk-list--bullet` and `--number`, `govuk-link`, `govuk-table__*`, `govuk-section-break`) and kebab-case ids to every heading (apostrophes are dropped, so "What's new" is `whats-new`; this is the usual convention, and I haven't confirmed it against the old Hub). Duplicate ids are numbered (`scope`, `scope-2`), and `main-content` and `skip-link` are never used. `headings` lists only the h2s, for the on-page contents.

`SafeHtml` is a branded type. Only this module creates one (a test checks), and templates output it in one place, `views/partials/rendered-markdown.njk` (a test fails if `| safe` appears in any other template). Pass `page.bodyHtml` to the `renderedMarkdown` macro.

## Key files

- `src/lib/markdown.ts`, `views/partials/rendered-markdown.njk`
- `src/repositories/content-read-repository.ts` (also `PageRecord` and `PageDetail` in `read-models.ts`, and `repositories.content`)
- `src/services/content/content-service.ts`
- `src/presenters/pages.ts`, and the view models in `src/view-models.ts`
- `src/routes/content.ts`. `src/routes/route-helpers.ts` holds `page()` and `identifierFrom()`, moved out of `catalogue.ts` so both routers share them.
- `views/pages/content-listing.njk`, `views/pages/content-page.njk`
- `test/e2e/support/serve-migrated.ts` and the `migrated` projects in `playwright.config.ts`

## Decisions

- **Migrated pages are tested by page type**, not by original source type (markdown, ERB). The old Hub's sources are never used, and the fixtures don't record the source.
- **`/whats-new/:slug` and `/pages/:slug` are not built.** They weren't in the brief. The migrated redirects that point at them show page not found, and `migrate:verify` lists them under `waitingForPhase6`. Policies and guidance were removed from that list.
- **`createApp` takes a required `content` dependency.** Existing tests and `migrate:verify` pass one.
- **Fixture database:** `gdshub_e2e_migrated`, dropped and recreated on every Playwright run, on the `DATABASE_URL` server, local servers only. The loader refuses a seeded database, which is why the migrated tests have their own. The second web server starts after the first, which builds the app. CI needs no change except a comment, as its Postgres user can create databases.
- **Test fixes while coding:** two of my own tests were wrong and were corrected. The listing page marks Policies `aria-current="page"` (and `"true"` on a policy page). A markdown link with a percent-encoded space is a relative address, so it isn't tested as a script address.

## Running the checks

- `npm run test:e2e` needs a seeded database: `db:migrate` then `db:seed` on an empty one. In this session `DATABASE_URL` pointed at `gdshub_migration`, so I created a separate `gdshub_e2e_seed` database on the same server, migrated and seeded it, and ran Playwright with `DATABASE_URL` pointing at it. Nothing was changed in `gdshub_migration`. Drop `gdshub_e2e_seed` when you no longer need it.
- `docker-compose.yml` is back on `gdshub`, the database the db service creates. An earlier commit on this branch had pointed the app container at `gdshub_migration`, which doesn't exist on a fresh volume, so database pages gave 500. To browse a migrated database, run the app with `DATABASE_URL=… npm run dev` as `docs/migration-validation.md` describes.

## Follow-ups

Logged in `docs/backlog.md`: the `/whats-new` and `/pages` routes and a `/whats-new` listing, markdown for instance text fields, renaming `waitingForPhase6`. Serving the old Hub's images was already there.
