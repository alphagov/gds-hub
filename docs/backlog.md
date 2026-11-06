# Backlog

Ideas raised during phases that are out of scope for the phase that found them.

- Choose and adopt a structured logging library behind the `Logger` interface (Phase 0).
- Configure Express `trust proxy` for the ALB and CloudFront chain so `req.ip` is correct (Phase 0).
- Add a readiness check that verifies the database connection, separate from `/health` (Phase 0).
- Log HTTP server `error` events raised after startup in `src/server.ts`. The `listen` callback only handles startup failures (Phase 0).
