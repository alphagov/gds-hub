# Phase 5: Data migration from the current Hub

Phase 5 is split in two. Part a (this session) builds the inventory and the extractor. Part b builds the loader, redirects table, reconciliation report, verify, the Playwright test and `docs/migration.md`.

## Part a: inventory and extractor

**Date:** 2026-11-11

**Status:** code complete. The sandbox has no Node.js, so the tests were written first and agreed with the developer, then the code was written without running anything. The developer ran the checks on the host and they pass (see [Steps to run on the host](#steps-to-run-on-the-host)). The developer also ran the inventory against the real Hub, and every kind of input passes (see [First real inventory](#first-real-inventory)). Two fixes were made after the security scan and review. They need one more run on the host (see [Fixes after review](#fixes-after-review)).

### What was built

- **Two inputs, both plain folders outside the repo:**
  - `HUB_BUILD_DIR`: the current Hub's built HTML
  - `HUB_DATA_DIR`: its YAML data files

  No git, Ruby or build is needed, so the same tooling can run live from S3 later (backlog).

- **Fail-fast settings.** The scripts stop before reading anything if a folder is unset or missing, is inside the repo, contains the repo, or links into the repo. The only exception is `test/fixtures/migration/`. They also stop if a selector, site address or asset path isn't valid.
- **The inventory** (`npm run migrate:inventory`) accounts for every built page and data file exactly once. Each ends as migrated, skipped with a reason, or manual review:

  | Kind                                                                      | What happens                                                                                                                                                      |
  | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Data file                                                                 | Read into records. A file the migration doesn't know goes to manual review.                                                                                       |
  | Page rendered from YAML (tool, instance, capability, business unit, team) | Matched to its record by its old address. It only becomes a redirect, never a page, so nothing is migrated twice. The record keeps the page's path (`builtPath`). |
  | Listing rendered from YAML                                                | Skipped, with a redirect to the page that replaces it. A listing with no replacement yet goes to manual review.                                                   |
  | Hand-written page                                                         | Converted from the built HTML into a page record.                                                                                                                 |
  | Redirect page                                                             | Becomes a redirect to wherever its target went.                                                                                                                   |
  | Anything else                                                             | Manual review.                                                                                                                                                    |

- **The extractor** keeps only the content area and removes the strip-list. It then converts the page to markdown with turndown:
  - headings, lists, simple tables, code blocks with their language, quotes, links and images
  - the title comes from the first h1, and a blog post's date from its "Published on" line
  - internal links and image paths are rewritten
  - tables markdown can't show, and elements it has no equivalent for, are kept as HTML and flagged for manual review
  - scripts and styles are removed with a warning
- **YAML mapping:**
  - Each tool becomes a tool record, a placeholder instance holding its own settings, and a contract when it has commercial fields.
  - Instances keep any field without its own column as an extra attribute.
  - Values that can't be stored are kept as text where possible, or flagged. Nothing is silently dropped.
- **Validation** uses shared Zod schemas (`src/validation/catalogue.ts`) that match the database's checks. It checks unique keys and slugs, and that every reference exists. It collects every problem, and never includes a value.
- **Reports** go to `migration-reports/` (git-ignored) as JSON. They hold paths, keys, counts and warnings, never content. Each kind of input has its own pass or fail: `content`, `yaml`, `listing`, `redirect` and `unknown`.
- **`npm run check:no-migration-data`** checks every tracked, staged or untracked (not ignored) file for:
  - migration output, reference material and `*.migration.log` files
  - dumps and exports
  - built Hub pages and Hub-shaped YAML
  - migration fixtures without the `SYNTHETIC FIXTURE` marker

  It runs in the CI lint job and in `.githooks/pre-commit`, which you install with `npm run hooks:install`.

- **The Playwright server uses the same database as everything else.** `playwright.config.ts` takes `DATABASE_URL` from the environment first, as in CI, and then from `.env`. Before, it was fixed at port 5432, so the e2e tests missed a local database on a different `DB_HOST_PORT`. This turned up when the checks were run on the host.

### First real inventory

The developer ran `migrate:inventory` against the real Hub on the host. Every kind of input passes, with no validation issues. Only counts are recorded here. The report itself stays in the git-ignored `migration-reports/`.

| Kind     | Items | Migrated | Skipped | Manual review | Records | Issues |
| -------- | ----- | -------- | ------- | ------------- | ------- | ------ |
| content  | 66    | 58       | 0       | 8             | 66      | 0      |
| yaml     | 483   | 481      | 0       | 2             | 781     | 0      |
| listing  | 20    | 0        | 19      | 1             | 0       | 0      |
| redirect | 5     | 5        | 0       | 0             | 565     | 0      |
| unknown  | 0     | 0        | 0       | 0             | 0       | 0      |

The 11 manual-review items are for the developer and content owners to agree in 5b. The `yaml` items include the pages rendered from the YAML as well as the data files. The `redirect` records include the redirect from every migrated page's old address, not only the 5 redirect pages.

### Fixes after review

Two problems found by the security scan and review before committing:

- **Redirect pages to another site.** A meta refresh to an absolute address on another site kept only its path. So a redirect to another site's `/tools/` page would have become a redirect to the new Hub's `/tools`, marked as migrated. `redirectOldPath` in `links.ts` (which replaces `resolveOldPath`) now treats a target as internal only if it is relative or on one of the `MIGRATION_SITE_ORIGIN` origins. Any other target goes to manual review. Run the real inventory again: if one of the 5 redirect pages goes to another site, it will now show as manual review.
- **Text that looks like markup.** Turndown escapes markdown in text but not `<` or `&`. Text that the built page showed as `<details>` (written `&lt;details&gt;`) would have become a real tag in the markdown. The same applied to entity-like text such as `&nbsp;`. The extractor now backslash-escapes a `<` that would start a tag, comment or autolink, and an `&` that would start an entity. Code is unchanged.

### Key files

```
src/validation/catalogue.ts                   shared Zod schemas and enum values, matching the database checks
src/migration/records.ts                      MigrationRecord, MigrationWarning, ValidationIssue
src/migration/config.ts                       loadMigrationOptions: settings, defaults and the folder guards
src/migration/hub-structure.ts                the current Hub's URL patterns, listings and page-type rules
src/migration/links.ts                        old paths and link rewriting
src/migration/extractor.ts                    built page -> title and markdown
src/migration/yaml-values.ts, yaml-records.ts YAML data files -> records
src/migration/validate.ts                     validateRecords
src/migration/inventory.ts                    buildMigrationPlan: items, records, issues, assets
src/migration/report.ts                       createInventoryReport, writeReport
src/migration/check-no-migration-data.ts      findMigrationDataProblems
src/migration/cli.ts                          command-line options and runInventory
src/migration/scripts/*.ts                    npm script entry points
.githooks/pre-commit                          runs check:no-migration-data
test/fixtures/migration/                      synthetic hub-build/ and hub-data/
test/unit/migration/*.test.ts, test/integration/migration-inventory.test.ts
```

### Script options and settings

`npm run migrate:inventory -- [options]`. Each option overrides its environment variable, which can also go in `.env`.

| Option               | Setting                      | Default                                                                   |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `--data`             | `HUB_DATA_DIR`               | required                                                                  |
| `--build`            | `HUB_BUILD_DIR`              | required                                                                  |
| `--content-selector` | `MIGRATION_CONTENT_SELECTOR` | `main`                                                                    |
| `--strip`            | `MIGRATION_STRIP_SELECTORS`  | none. Comma-separated, added to the defaults in `DEFAULT_STRIP_SELECTORS` |
| `--site-origin`      | `MIGRATION_SITE_ORIGIN`      | none. Absolute links to it count as internal                              |
| `--asset-base-path`  | `MIGRATION_ASSET_BASE_PATH`  | `/hub-assets`                                                             |
| `--report-dir`       | `MIGRATION_REPORT_DIR`       | `migration-reports/`                                                      |

The script exits 0 if every kind of input passes, 1 if any fails, and 2 if a setting is missing or invalid.

### Decisions

- **Built HTML and YAML only** (developer's decision). The old Hub's page sources and front matter aren't used, because a live migration will only have the built site (in S3) and the data files. As a result, review dates, owners and blog abstracts on content pages aren't migrated (backlog).
- **Structured data comes from the YAML, not scraped from the HTML.** The built pages lose too much: tool keys, blank fields, defaults, weights, and review dates that aren't overdue.
- **Each YAML record is migrated once.** Its built page only gives the redirect from its old address, and in 5b, the comparison check.
- **Key-based URLs.** Tools, instances and teams use their YAML key as their slug, and the old name-based addresses become redirects.
- **New addresses for content pages:** `/policies/<slug>`, `/guidance/<slug>` (guidance and service guides), `/whats-new/<slug>` and `/pages/<slug>` (general). Phase 6 needs routes that match. The section rules are committed in `hub-structure.ts` (developer's decision).
- **A placeholder instance for every tool** (developer's decision). It holds the tool's own settings, even when the tool has real instances, and teams' `uses` will link to it in 5b.
- **`contracts.supplier_id` will be nullable** (developer's decision). The schema change is in 5b, with the `redirects` migration.
- **The current Hub's quirks:**
  - Instances match their tool exactly. A match only the old substring rule would have made is flagged.
  - A tool with no ownership level falls back to `undocumented`, as before, with a warning that doesn't need review.
  - A team that no business unit operates is a validation issue, as it was a build failure.
  - A key given twice in a data file keeps its last value, as Ruby's YAML parser did for the current Hub, instead of the whole file failing. The file and the repeated record are flagged for manual review, with the line numbers. The first real inventory found one in the tools file. That was fixed in the current Hub's data, but a repeat now flags just that record rather than failing the whole file.
- **Parse errors give the parser's reason and the line,** never its message or a snippet, because those quote the file.
- **Fields found by the first real inventory** (developer's decisions):
  - A tool's `escalation_contact` goes on its placeholder instance, so the tool page shows it.
  - `license_cost` and `license_terms` go on the contract, as `cost` and `license_terms`.
  - `technical_lead`, `dpia_url`, `has_had_data_protection_impact_assessment` and `gds_domain_restricted_sso` have no column of their own, so they are kept as the placeholder instance's extra attributes.
  - A business unit's `child_units` become the parent of each unit listed (`childKeys`, which the loader in 5b turns into `parent_id`). Each listed unit must exist, can only have one parent, and can't end up inside its own list of child units.
- **Identity migration statuses:** "Not started yet", "Migration to DSIT in progress" and "Migration to DSIT complete" map to their statuses, and "Awaiting IdAM" counts as in progress (developer's decision). "Not applicable" is a new `migration_status` value, `not_applicable` (developer's decision). Adding an enum value is backward compatible. The tool page shows it as a grey "Not applicable" tag.
- **Actor:** 5b writes as `system:data_migration`, which Phase 3 already defines.
- **Keys and slugs are limited to 160 characters** by the shared schema. This matches what read pages accept (a Phase 4 follow-up).
- **cheerio's node types** come from `domhandler`, its own dependency, through a type-only import. The installed turndown types need the DOM library, which this project doesn't load, so the extractor does its analysis in cheerio and reads turndown nodes through a small typed interface.

### Steps to run on the host

Already done on the host. All checks pass:

```sh
npm run db:generate     # added drizzle/0003_normal_mad_thinker.sql (the not_applicable value)
npm run db:migrate
npm run format
npm run lint && npm run typecheck
npm test && npm run test:e2e
npm run check:no-migration-data
npm run hooks:install   # once, to run the data check before every commit
```

Still to do, after the [fixes after review](#fixes-after-review):

```sh
npm run format
npm run lint && npm run typecheck
npx vitest run test/unit/migration test/integration/migration-inventory.test.ts
npm test
npm run check:no-migration-data
npm run migrate:inventory   # against the real Hub, to check the redirect pages
```

### Blockers and missing packages

- No Node.js in the sandbox, so nothing was run there.
- No packages are missing. The developer installed cheerio, js-yaml, turndown and `@types/turndown` before the session. js-yaml 5 has its own types, so `@types/js-yaml` was uninstalled again, and typecheck still passes.

### Follow-ups (part b)

- Add a `redirects` table (`old_path` unique, `new_path`) with its repository, make `contracts.supplier_id` nullable, and run `db:generate` on the host.
- Add the loader: dry run by default, `--apply` through the repositories in batched transactions as `system:data_migration`, and idempotent upserts.
- Add the reconciliation report, `migrate`, `migrate:verify` (including the comparison with the Phase 4 pages), the integration tests on Postgres, the Playwright test and `docs/migration.md`.
- Agree the 11 manual-review items from the first real inventory with the content owners, and record the process in `docs/migration.md`.
- Decide what happens to redirect pages that go to another site. `redirectFields.newPath` only allows paths on this site, so for now they stay as manual review.
- Make `migrate:verify` flag a redirect whose old path is also a page on the new site. Express ignores trailing slashes, so `/tools/a-name/` (an old tool address) also reaches the new `/tools/a-name` page, which may be a different tool.
- Rendering (Phase 6) must sanitise the HTML that pages keep (tables markdown can't show, iframes, forms and other elements). The extractor keeps their attributes as written and only flags them for manual review.
