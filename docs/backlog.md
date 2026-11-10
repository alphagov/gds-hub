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
