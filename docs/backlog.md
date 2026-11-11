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
- Decide whether `contracts.supplier_id` should be nullable or whether Phase 5 creates a placeholder supplier, since the current YAML has no supplier data (Phase 2, for Phase 5).
- Check an "expected `updatedAt`" on update, so an editor can't silently overwrite a change made since they opened the form (Phase 3, for Phase 8).
- Write `publish` and `unpublish` audit actions once pages have a draft workflow (Phase 3).
- A batch `lastUpdated` for list pages, to avoid one query per row (Phase 3, for Phase 4 or 11).
- Move the seed onto the repositories, so seed audit entries follow the same actor convention (`actor_name` = `actor_subject`) as everything else (Phase 3).
- The database import lint rule doesn't catch dynamic `import()`. Add a check if dynamic imports are ever used in `src` (Phase 3).
