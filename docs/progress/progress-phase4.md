# Phase 4: Read journeys

**Date:** 2026-11-11

**Status:** code complete. The sandbox has no Node.js, so the code and tests were written without running anything. The developer ran lint, typecheck, Vitest and Playwright on the host. One failure was fixed (see the `pageContent` decision), and the checks are green.

## What was built

- Read-only pages for the catalogue, built from the Phase 3 repositories: home, capabilities, tools, instances, products, teams and services, business units and vendors (see the [route table](#route-table)).
- **The tool page shows how to get access to each instance.**
  - Each instance's access information is in its own `govukDetails`: Getting access, Authentication, User provisioning and Escalation contact. Empty fields are left out. If none are recorded, the page says so.
  - A `govukTag` shows the instance's migration to DSIT identity: "Not started" (grey), "In progress" (blue, the default) or "Complete" (green).
  - Instances that aren't in use get a grey "Not in use" tag.
  - A placeholder instance holds the tool's own settings. It's shown on the tool page with no heading or link of its own.
- **Access instructions are 3 clicks from the home page:** a capability, then a tool, then "Getting access". A Playwright test follows this journey.
- **Breadcrumbs on every page except home.** The service navigation marks the page's section, including on pages whose address isn't under the section's path (instances and vendors are in Tools, business units in Services).
- **A left-hand contents on every page except error pages** (developer's decision: the capability tree on every page). It lists the capability groups and their capabilities in weight order, leaving out those set to hide in navigation. On a capability's page, that capability is marked as the current page.
  - From the desktop breakpoint (769px) up, it's always shown in a quarter-width column.
  - Below it, it's inside a "Contents" `govukDetails` above the page content, which opens and closes without JavaScript.
- Weight ordering wherever there is a weight: capabilities, business units and products, teams and services. Records with no weight come last, then name order.
- The Tools, Capabilities and Services section pages are real listings now. Policies, Guidance and Search are still placeholders, but now with the contents.
- The server opens the database pool at startup and closes it on shutdown. The pool has a 5-second connection timeout and a 10-second statement timeout. If an idle connection fails, the error is logged instead of stopping the process.

## Key files

```
src/site-map.ts                                  CATALOGUE_ROUTES, CATALOGUE_PATHS, CONTENTS_LABEL, applicationStylesheet
src/repositories/read-models.ts                  CapabilityDetail, ProductTeamServiceDetail, BusinessUnitDetail, VendorDetail, ServiceDirectory and their parts
src/repositories/catalogue-read-repository.ts    getCapabilityDetail, getProductTeamServiceDetail, getBusinessUnitDetail, getVendorDetail, getServiceDirectory
src/services/catalogue/ordering.ts               compareByWeightThenName, groupCapabilitiesForNavigation (pure)
src/services/catalogue/catalogue-service.ts      CatalogueService, createCatalogueService
src/presenters/format.ts                         paragraphs, safeHref, websiteLink, emailLink, formatDate, dateRange, textRows, migrationStatusTag
src/presenters/contents.ts                       contentsNavigation, capabilityGroupList
src/presenters/capabilities.ts                   presentHome, presentCapabilities, presentCapability, instanceLink
src/presenters/tools.ts                          presentTools, presentTool, presentInstance, presentVendor, instanceAccess, accessDetails, presentContract
src/presenters/organisation.ts                   presentServices, presentProductTeamService, presentBusinessUnit
src/routes/catalogue.ts                          catalogueRouter: every route in the route table
src/routes/pages.ts                              placeholders for Policies, Guidance and Search
src/view-models.ts                               the view models below
src/lib/navigation.ts                            serviceNavigation(path, section?)
src/db/client.ts, src/server.ts                  pool timeouts and idle-error handling, wiring and shutdown
views/layouts/base.njk                           the grid with the contents column
views/layouts/catalogue.njk                      caption, h1, lead and body for record pages
views/partials/*.njk                             the reusable partials below
views/pages/*.njk                                one template per page type
public/stylesheets/application.css               shows the right copy of the contents at each screen size
test/unit/catalogue-ordering.test.ts, catalogue-service.test.ts, presenters.test.ts, catalogue-routes.test.ts
test/unit/catalogue-fixtures.ts                  invented records and a fake CatalogueService
test/integration/catalogue-read-models.test.ts, database-client.test.ts
test/e2e/catalogue.spec.ts, accessibility.spec.ts
```

## Route table

| Route                               | Template                         | View model                    | Breadcrumbs                  | Section      |
| ----------------------------------- | -------------------------------- | ----------------------------- | ---------------------------- | ------------ |
| `/`                                 | `pages/home.njk`                 | `HomeViewModel`               | none                         | none         |
| `/capabilities`                     | `pages/capabilities.njk`         | `CapabilitiesViewModel`       | Home                         | Capabilities |
| `/capabilities/:key`                | `pages/capability.njk`           | `CapabilityViewModel`         | Home › Capabilities          | Capabilities |
| `/tools`                            | `pages/tools.njk`                | `ToolsViewModel`              | Home                         | Tools        |
| `/tools/:slug`                      | `pages/tool.njk`                 | `ToolViewModel`               | Home › Tools                 | Tools        |
| `/instances/:slug`                  | `pages/instance.njk`             | `InstanceViewModel`           | Home › Tools › _tool_        | Tools        |
| `/vendors/:slug`                    | `pages/vendor.njk`               | `VendorViewModel`             | Home › Tools                 | Tools        |
| `/services`                         | `pages/services.njk`             | `ServicesViewModel`           | Home                         | Services     |
| `/services/:slug`                   | `pages/product-team-service.njk` | `ProductTeamServiceViewModel` | Home › Services              | Services     |
| `/business-units/:key`              | `pages/business-unit.njk`        | `BusinessUnitViewModel`       | Home › Services (› _parent_) | Services     |
| `/policies`, `/guidance`, `/search` | `pages/section.njk`              | `SectionViewModel`            | Home                         | own section  |

- Capabilities and business units have no slug column, so their pages use the key.
- A slug or key that isn't kebab case (or is over 160 characters) gets the 404 page without a database query. An unknown one gets the 404 page after the lookup.
- Read pages have no `Cache-Control` header, as before. The 404 and 500 pages are `no-store`, and Search is still `no-store`.

## View models and presenters

- Every view model is in `src/view-models.ts`. `PageViewModel` adds two optional fields:
  - `section`: which service navigation item to mark
  - `contents`: a `ContentsViewModel`, the left-hand contents
- `CataloguePageViewModel` adds `caption`, shown above the h1. For example, an instance page's caption is its tool.
- Shared parts:
  - `InstanceAccessViewModel`, an instance's access information. Its `details` are `AccessDetailViewModel` items.
  - `ContractViewModel`, a contract shown as a summary card
  - `TagViewModel`, the parameters for `govukTag`
  - `SummaryRow`, a plain-text summary list row
- Presenters in `src/presenters` turn read models into view models. They are pure functions, unit tested without a database or templates. Templates only loop, test conditions and capture HTML to pass to GOV.UK macros.
- Multi-line text fields are split into paragraphs at blank lines and shown as escaped plain text. They aren't treated as markdown (no markdown library yet).
- Links:
  - **Websites and Slack channels:** only linked if they're absolute `http` or `https` addresses (`safeHref`), on top of the database check.
  - **Email addresses:** only linked if they're plain addresses. Anything else is shown as text.
  - **GitHub organisations:** link to `https://github.com/<organisation>`.

## Reusable partials

| Partial                            | Gives                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `partials/contents-navigation.njk` | The left-hand contents. Included by `layouts/base.njk` when `page.contents` has groups |
| `partials/contents-list.njk`       | The list inside it (used twice: full and collapsible)                                  |
| `partials/text.njk`                | `paragraphs(texts, classes)`                                                           |
| `partials/link-list.njk`           | `linkList(items, emptyText)`: links with descriptions, or an empty message             |
| `partials/capability-groups.njk`   | `capabilityGroups(groups)`: headings with their capabilities                           |
| `partials/instance-access.njk`     | `instanceAccess(access)` for the tool page, and `accessDetails(details)`               |
| `partials/contract.njk`            | `contractCard(contract, headingLevel)`                                                 |

Layouts:

- **`layouts/base.njk`:** the template every page extends. Its `content` block now holds the grid with the contents column. Pages override its `pageContent` block, never `content` or `main`. In `govuk/template.njk`, `main` is the block that holds the `<main>` element, so overriding it drops the `<main>` landmark, the skip link's target and the grid.
- **`layouts/content.njk` and `layouts/listing.njk`:** now override `pageContent`.
- **`layouts/catalogue.njk`:** new, for record pages. It has `heading`, `lead` and `body` blocks.

## How to add a catalogue page

1. Add a read model to `src/repositories/read-models.ts` and its query to `catalogue-read-repository.ts` (one read-only snapshot), with an integration test.
2. Add a method to `CatalogueService`.
3. Add a view model to `src/view-models.ts`, register the template in `Views`, and write a presenter in `src/presenters` with a unit test. Set `section`, `breadcrumbs` and `contents: contentsNavigation(groups)`.
4. Add the route pattern to `CATALOGUE_ROUTES` and the path builder to `CATALOGUE_PATHS` in `src/site-map.ts`. Then add the route in `src/routes/catalogue.ts` with `page(...)` and `detail(...)`.
5. Write the template in `views/pages/`, extending `layouts/catalogue.njk`.
6. Add the page to `PAGES` in `test/e2e/accessibility.spec.ts`, and add it to `fakeCatalogue` and `PAGES` in `test/unit/catalogue-routes.test.ts`.

## Decisions

- **The contents is the capability tree on every page** (developer's decision). The other options were an "On this page" list, or a mix by page type. Error pages have no contents, so they never depend on the database.
- **The contents is rendered twice, and CSS shows one copy.** There's a full list for large screens and a `govukDetails` for small ones. `display: none` takes the hidden copy out of the accessibility tree, so there's one navigation landmark with one visible list. This works without JavaScript and only uses GOV.UK Frontend's details component. The contents sits inside `<main>`, before the page content.
- **`hide_in_navigation` only hides a capability from navigation:** the contents and the home and capabilities lists. Its page still works, and tool pages still link to it.
- **Capability groups are in the order of their lowest-weighted capability, then name.** Capabilities with no group come last, under "Other capabilities". Group names are matched after trimming spaces. This ordering is done in the service, because the grouping is too. Business units and teams are ordered in SQL (`weight ASC NULLS LAST, name, id`).
- **A product, team or service in more than one business unit is listed under each one** on the Services page. Its breadcrumbs stop at Services, because there's still no "primary" business unit (backlog).
- **A business unit's breadcrumbs include its parent,** one level up.
- **Placeholder instances link to their tool,** not to their own instance page, wherever they're listed. Their instance page still works if visited directly.
- **The layouts' content block is called `pageContent`.** At first it was called `main`, which clashed with GOV.UK Frontend's own `main` block. That dropped the `<main>` element and the contents column, and the host test run caught it. A renderer test now checks that the grid is inside `<main id="main-content">`.
- **Database resilience for the server** (from the pre-PR review). `connect()` takes three options, and only `src/server.ts` sets them:
  - **`connectionTimeoutMs` (5 seconds) and `statementTimeoutMs` (10 seconds):** every read page queries the database, so a slow or unreachable database now gives the 500 page instead of holding requests and pool connections open. `test/integration/database-client.test.ts` checks the statement timeout.
  - **`onIdleError`:** logs a failed idle connection instead of letting Node stop the server.
  - **The `src/db` scripts set none of them,** so migrations and the seed have no time limit and still stop on a connection error, as before.
- **The seed** (synthetic) gained capability weights that differ from name order, a hidden capability ("Legacy build servers"), and weights on two teams, so the ordering and hiding can be tested end to end.
- **CI:** the e2e job runs `db:migrate` and `db:seed` before Playwright.

## Steps to run on the host

```sh
docker compose up -d db
npm run db:reset   # the seed changed, and the e2e tests read the seed
npm run format     # Prettier couldn't run in the sandbox
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

## Blockers and missing packages

- No Node.js in the sandbox, so nothing was run there. The developer ran every check on the host.
- No packages are missing.
- `npm run check:no-migration-data` still doesn't exist (Phase 0 follow-up), so it couldn't be run.

## Follow-ups

- Show `lastUpdated` (who changed a record and when) on the read pages (Phase 11).
- Markdown in instance text fields once `src/lib/markdown.ts` exists. Until then, links in that text aren't clickable.
- Decide a primary business unit for products, teams and services, for their breadcrumbs (backlog, Phase 5).
- Every page loads all capabilities for the contents. That's a small query, but consider caching it once editing exists (backlog).
- Consider redirecting a placeholder instance's own page to its tool page (backlog).
- On desktop, keyboard users tab through the contents before the page content. Consider a "skip to page content" link if user research shows it's a problem (backlog).
