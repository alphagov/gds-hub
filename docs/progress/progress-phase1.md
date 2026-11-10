# Phase 1: GOV.UK shell and server-side rendering

**Date:** 2026-11-09

**Status:** complete. The sandbox has no Node.js, so the tests were written first, reviewed by the developer, then the code was written without running it. The developer ran lint, typecheck, Vitest and Playwright on the host and all pass. The one fix needed was the no-JavaScript axe scans (see Decisions).

## What was built

- GOV.UK Frontend 6.6 served from `node_modules`: precompiled CSS and JS, fonts, images and the web manifest. There is no Sass build yet.
- Nunjucks with `autoescape: true`, loading templates from `views/` and `govuk-frontend/dist`.
- `layouts/base.njk` extends `govuk/template.njk`. It has the GOV.UK Frontend generic header with "GDS Hub" in place of the GOV.UK logo, service navigation (links only, no repeated service name) (Tools, Capabilities, Services, Policies, Guidance, Search) with the current section marked, a "Beta" phase banner, breadcrumbs and the footer.
- `layouts/content.njk` and `layouts/listing.njk`, with blocks that pages can override.
- A placeholder home page, plus placeholder listing pages for each section. `/search` is `Cache-Control: no-store`.
- GOV.UK 403, 404 and 500 pages rendered by one central error handler. Error pages are `no-store`.
- A typed render helper: each template is paired with its view model type at compile time.
- A Content-Security-Policy that uses a per-request nonce for GOV.UK's one inline script. `'unsafe-inline'` is not allowed in `script-src`.
- Playwright runs the layout tests twice: in `chromium` and in `chromium-no-js` (`javaScriptEnabled: false`). axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`; the tags aren't cumulative, so every version's A and AA tags are listed) scans every route, including the error pages, both normally and with JavaScript off.

## Key files

```
src/site-map.ts             service name, section names and paths, asset URLs, test-only routes,
                            error page titles. The single source for the app and the tests.
src/view-models.ts          view model types and the Views registry (template -> view model)
src/lib/render.ts           createRenderer(): renderToString() and render(res, ...)
src/lib/navigation.ts       serviceNavigation(path): items with current/active worked out
src/lib/http-error.ts       HttpError(403 | 404 | 500)
src/paths.ts                views/, public/ and govuk-frontend/dist on disk
src/middleware/csp-nonce.ts res.locals.cspNonce for each request
src/middleware/error-handler.ts  notFoundHandler() and errorHandler(renderer)
src/routes/assets.ts        static files
src/routes/pages.ts         home and section placeholder pages
src/routes/test-only.ts     /__test/forbidden and /__test/error (NODE_ENV=test only)
views/layouts/              base.njk, content.njk, listing.njk
views/pages/                home.njk, section.njk
views/errors/               403.njk, 404.njk, 500.njk
public/javascripts/application.js  calls GOV.UK Frontend initAll()
```

## Layout block names

| Layout        | Blocks                                                          | Reads from `page`      |
| ------------- | --------------------------------------------------------------- | ---------------------- |
| `base.njk`    | `breadcrumbs`, `content`, and any `govuk/template.njk` block    | `title`, `breadcrumbs` |
| `content.njk` | `heading` (default h1 is `page.title`), `lead`, `body`, `aside` | `title`                |
| `listing.njk` | `heading`, `intro`, `filters`, `list`, `emptyState`             | `title`, `items`       |

`base.njk` also fills these GOV.UK template blocks: `pageTitle`, `head` (stylesheet), `govukServiceNavigation`, `beforeContent` (phase banner and breadcrumbs) and `bodyEnd` (application script).

## View-model convention

- Templates receive two objects. `page` is the view model from `src/view-models.ts`. `layout` is built by the renderer: service name, home path, document title, navigation and asset URLs. GOV.UK's own `cspNonce` and `assetPath` are also passed.
- Templates never see `req`, `res` or database rows. Work out anything conditional (active navigation, titles, cache rules) in TypeScript.
- Every view model extends `PageViewModel` (`title`, optional `breadcrumbs`). Listing pages extend `ListingViewModel` (`items`).
- The document title is `"{title} - GDS Hub"`, or just `"GDS Hub"` on the home page (`documentTitle()` in `site-map.ts`).

## How to add a route and template

1. If it's a new section, add it to `SECTIONS` in `src/site-map.ts`. The navigation, home page, placeholder route, unit tests and axe scan all pick it up.
2. Add a view model interface to `src/view-models.ts` and register the template in `Views`, for example `"pages/tool.njk": ToolViewModel`.
3. Create the template in `views/pages/`, extending `layouts/content.njk` or `layouts/listing.njk`. Use official `govuk*` macros only.
4. In a router, build the view model and call `renderer.render(res, "pages/tool.njk", model).catch(next)`. To send an error page, call `next(new HttpError(404))`.
5. Add the route to the `PAGES` list in `test/e2e/accessibility.spec.ts` if it isn't a section.

## Decisions

- **Shared site map:** routes, names and titles live in `src/site-map.ts`, which has no runtime dependencies. The Playwright specs import it directly.
- **Navigation matching ignores letter case.** Express routing is case-insensitive, so `/Tools` renders the Tools page, and `serviceNavigation` lower-cases the path so the current section is still marked.
- **Placeholder pages for every section,** so no navigation link leads to a 404 and `listing.njk` is covered by axe.
- **Test-only routes** for reaching the 403 and 500 pages are mounted only when `NODE_ENV=test`. A unit test checks that they return 404 in production and development.
- **Unknown routes now return the HTML 404 page,** replacing Phase 0's JSON. The JSON 404 test in `health.test.ts` was removed; `/health` itself is still JSON.
- **axe scans the no-JavaScript pages without turning JavaScript off.** axe runs through `page.evaluate`, which hangs when `javaScriptEnabled` is false, so `accessibility.spec.ts` is ignored in `chromium-no-js`. Instead, its "without JavaScript" tests replace the page's CSP with `script-src 'none'`, which blocks the page's own scripts (GOV.UK's inline script and `application.js`) while axe still runs. Each of those tests also checks that `js-enabled` isn't set on the body.
- **Generic header, not the GOV.UK header.** The Hub is an internal tool, not a GOV.UK service, so `base.njk` overrides the `govukHeader` block with `govukGenericHeader` showing the service name. The service name isn't repeated in the service navigation.
- **CSP nonce rather than a hash** for the inline `js-enabled` script. A hash would change with every govuk-frontend release.
- **`upgrade-insecure-requests` is only sent in production.** Locally and in tests the app is served over plain HTTP, where upgrading would break asset requests.
- **Client errors keep their status.** Express and its file-serving middleware attach 4xx statuses to errors, such as the 416 that `res.sendFile` passes on for an unsatisfiable `Range` header. The error handler keeps these: 403 and 404 get their GOV.UK page, and other 4xx statuses get a short plain-text response with the error's headers (for example `Content-Range`). Client errors aren't logged separately, because the request logger records their status. Only unexpected errors become a 500 logged at error level.
- **If the error page itself fails to render,** the handler sends a plain-text 500 with the request ID. If the response had already started, it closes the connection.
- **The phase banner has no feedback link** yet, because there's nowhere for feedback to go.
- **`views/` and `public/` are at the repo root,** so they resolve the same from `src/` and `dist/`. The Dockerfile copies both into the runtime image.

## Blockers and missing packages

- No Node.js in the sandbox (`node`, `npm` and `npx` are all missing), so nothing was run.
- No Playwright browsers in the sandbox.
- `node_modules` still has only the macOS esbuild and rolldown bindings (see Phase 0).

## Things to check when running on the host

- Playwright resolving `../../src/site-map.js` to the `.ts` file from the E2E specs.
- Prettier formatting was done by hand. Run `npm run format` if `npm run lint` reports formatting only.

## Follow-ups

- Feedback link in the phase banner, once there's a destination.
- Review cache headers for static assets in Phase 12 (they currently use Express static defaults).
- In Phase 12, check how the per-request CSP nonce works with CloudFront caching. A cached page and its CSP header are cached together, so they still match, but the nonce is then reused across responses.
- `npm run check:no-migration-data` still doesn't exist (Phase 0 follow-up).
