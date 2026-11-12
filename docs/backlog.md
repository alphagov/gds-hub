# Backlog

Ideas raised during phases that are out of scope for the phase that found them.

- Choose and adopt a structured logging library behind the `Logger` interface (Phase 0).
- Configure Express `trust proxy` for the ALB and CloudFront chain so `req.ip` is correct (Phase 0).
- Add a readiness check that verifies the database connection, separate from `/health` (Phase 0).
- Log HTTP server `error` events raised after startup in `src/server.ts`. The `listen` callback only handles startup failures (Phase 0).
- Add a feedback link to the phase banner once there is somewhere for feedback to go (Phase 1).
- Set cache headers for static assets, ideally with fingerprinted file names (Phase 1, for Phase 12).
- Check how the per-request CSP nonce works with CloudFront caching of read pages (Phase 1, for Phase 12).
- Replace the GOV.UK crown favicons and web manifest (the `headIcons` block) with Hub icons, to match the generic header (Phase 1).
- Copy `drizzle/` into the runtime Docker image and decide how migrations run in ECS (Phase 2, for Phase 13).
- Record a "primary" business unit for a product, team or service that sits in more than one unit, for its URL and navigation parent (Phase 2, for Phase 4 or 5).
- Check an "expected `updatedAt`" on update, so an editor can't silently overwrite a change made since they opened the form (Phase 3, for Phase 8).
- Write `publish` and `unpublish` audit actions once pages have a draft workflow (Phase 3).
- A batch `lastUpdated` for list pages, to avoid one query per row (Phase 3, for Phase 4 or 11).
- Move the seed onto the repositories, so seed audit entries follow the same actor convention (`actor_name` = `actor_subject`) as everything else (Phase 3).
- The database import lint rule doesn't catch dynamic `import()`. Add a check if dynamic imports are ever used in `src` (Phase 3).
- Cache the capability groups for the left-hand contents, which every page loads, once editing can change them (Phase 4).
- Redirect a placeholder instance's own page to its tool's page, since nothing links to it (Phase 4).
- Consider a "skip to page content" link past the left-hand contents for keyboard users on desktop, if research shows it's needed (Phase 4).
- Render instance text fields as markdown once `src/lib/markdown.ts` exists, so links in access instructions are clickable (Phase 4).
- Read pages refuse slugs and keys over 160 characters (the length of `pages.slug`) before querying. Other slug and key columns have no length limit, so Phase 5 should flag any longer ones, or a check constraint should match the limit (Phase 4, for Phase 5).
- Make the database connection and statement timeouts configurable through `Config` if the defaults (5 and 10 seconds) need tuning per environment (Phase 4, for Phase 13).
- Set up the one-off ECS task for the live migration: its task definition, a task role with read access to the frozen inputs' S3 prefixes and write access to a report prefix, and the private, versioned input bucket. The scripts already read from S3 and take `--database-host` for RDS (see `docs/migration.md`) (Phase 5b, for Phase 13 or 14).
- Review dates, owners and blog abstracts on content pages aren't migrated, because they're only in the old Hub's source front matter. Content owners set them again after migration, or an optional front matter input is added (Phase 5).
- Log the database error code (SQLSTATE, for example `42P01` or `57014`) or the driver's error name with a failed `RepositoryError`, without its message or query parameters, so a 500 caused by the database can be diagnosed from the logs (Phase 5a, for Phase 15).
- Show a placeholder instance's extra attributes on its tool page. The migration keeps tool fields with no column of their own there (for example the technical lead), but the tool page doesn't show them yet (Phase 5a, for Phase 6 or 8).
- Decide what happens to the current Hub's redirect pages that go to another site: drop them, or recreate them in CloudFront. They stay as manual review (Phase 5b).
- Serve the old Hub's images and downloads once hosting them is decided. Content pages already link to them under `MIGRATION_ASSET_BASE_PATH` (Phase 5, for Phase 6).
- Add an option to `migrate:load` to overwrite records an editor has changed, if a re-run after cut-over is ever needed. For now they are always skipped (Phase 5b).
- Cache redirect lookups, or the redirect responses at CloudFront, if 404 traffic to old addresses turns out to be heavy (Phase 5b, for Phase 12).
- Connect to RDS over TLS, checking its certificate (for example `sslmode=verify-full` with the RDS certificate bundle in the image), for the app and the migration task. The migration's AWS run waits for this (Phase 5b, for Phase 13).
