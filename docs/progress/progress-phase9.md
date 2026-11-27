# Phase 9: Preview

**Date:** 2026-11-27

**Status:** code complete. `npm run lint`, `npm run typecheck` and `npm test` (Vitest, including the integration tests) pass in the sandbox. `npm run test:e2e` passes in the sandbox against the `gdshub_e2e_seed` database (see "Steps to run on the host"). Nothing needs running on the host except the steps below.

Branch: `DX-323/phase9-preview` (from `main`).

## Done when (from `docs/build-plan.md`)

| Item                                | Result                                                |
| ----------------------------------- | ----------------------------------------------------- |
| Preview never writes to the database | Met. Tests count rows and audit entries before and after a preview. |
| A tampered payload is rejected       | Met. Unit, integration and Playwright tests cover it. |
