import { expect, test, type Locator, type Page } from "@playwright/test";
import { documentTitle, ERROR_PAGES, HOME_PATH, SECTIONS } from "../../src/site-map.js";

// These tests read the synthetic seed (src/db/seed/seed-data.ts). Run
// `npm run db:reset` before running them locally.

const SMALL_SCREEN = { width: 375, height: 800 } as const;

function mainHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 });
}

/** The page's own content, beside the left-hand contents. */
function pageContent(page: Page): Locator {
  return page.getByRole("main").locator(".govuk-grid-column-three-quarters-from-desktop");
}

function contents(page: Page): Locator {
  return page.getByRole("navigation", { name: "Contents" });
}

function breadcrumbs(page: Page): Locator {
  return page.getByRole("navigation", { name: "Breadcrumb" });
}

function serviceNavigation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Menu" });
}

/** A govukDetails' summary, which opens and closes it. */
function detailsSummary(scope: Locator, text: string): Locator {
  return scope.locator("summary").filter({ hasText: text });
}

function summaryRow(scope: Locator, key: string): Locator {
  return scope.locator(".govuk-summary-list__row").filter({ hasText: key });
}

test("you can find how to get access to a tool from the home page in three clicks", async ({
  page,
}) => {
  await page.goto(HOME_PATH);

  await pageContent(page).getByRole("link", { name: "Continuous integration" }).click();
  await expect(mainHeading(page)).toHaveText("Continuous integration");

  // exact, because the capability page also links to the "Pipeline Pilot (GDS)" instance.
  await pageContent(page).getByRole("link", { name: "Pipeline Pilot", exact: true }).click();
  await expect(mainHeading(page)).toHaveText("Pipeline Pilot");

  const instructions = pageContent(page).getByText(
    "Ask in the #build-tools channel and give your team name.",
  );
  await expect(instructions).toBeHidden();
  await detailsSummary(pageContent(page), "Getting access").click();

  await expect(instructions).toBeVisible();
});

test("you can reach a capability from the contents on any page", async ({ page }) => {
  await page.goto(SECTIONS.tools.path);

  await contents(page).getByRole("link", { name: "Dependency scanning" }).click();

  await expect(page).toHaveURL("/capabilities/dependency-scanning");
  await expect(mainHeading(page)).toHaveText("Dependency scanning");
  await expect(contents(page).getByRole("link", { name: "Dependency scanning" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the contents lists capabilities by group in their set order", async ({ page }) => {
  await page.goto(HOME_PATH);

  await expect(contents(page).getByRole("link")).toHaveText([
    "Continuous integration",
    "Dependency scanning",
    "Incident alerting",
    "Team messaging",
    "Online whiteboards",
    "Accessibility testing",
  ]);
});

test("capabilities hidden from navigation aren't listed, but their page still works", async ({
  page,
}) => {
  await page.goto(HOME_PATH);
  await expect(page.getByRole("link", { name: "Legacy build servers" })).toHaveCount(0);

  await page.goto("/capabilities/legacy-build-servers");

  await expect(mainHeading(page)).toHaveText("Legacy build servers");
});

test("the tool page shows each instance's migration status", async ({ page }) => {
  await page.goto("/tools/sentinel-scan");

  await expect(summaryRow(pageContent(page), "Migration to DSIT identity")).toContainText(
    "In progress",
  );
});

test("the tool page shows authentication, user provisioning and escalation contacts", async ({
  page,
}) => {
  await page.goto("/tools/pipeline-pilot");
  const content = pageContent(page);
  await detailsSummary(content, "Authentication").click();
  await detailsSummary(content, "User provisioning").click();

  await expect(content.getByText("Sign in with Google")).toBeVisible();
  await expect(content.getByText("Accounts are created when you first sign in.")).toBeVisible();

  await page.goto("/tools/pagewatch");
  await detailsSummary(pageContent(page), "Escalation contact").click();

  await expect(
    pageContent(page).getByText("Out of hours, page the platform on-call rota."),
  ).toBeVisible();
});

test("an instance page shows how to get access and links back to its tool", async ({ page }) => {
  await page.goto("/tools/chatterbox");
  await pageContent(page).getByRole("link", { name: "Chatterbox workspace" }).click();

  await expect(mainHeading(page)).toHaveText("Chatterbox workspace");
  await detailsSummary(pageContent(page), "Getting access").click();
  await expect(
    pageContent(page).getByText("Request access through the software service desk."),
  ).toBeVisible();

  await breadcrumbs(page).getByRole("link", { name: "Chatterbox" }).click();
  await expect(page).toHaveURL("/tools/chatterbox");
});

test("service navigation shows Tools as the section you are in on an instance page", async ({
  page,
}) => {
  await page.goto("/instances/pipeline-pilot-gds");

  await expect(
    serviceNavigation(page).getByRole("link", { name: SECTIONS.tools.name }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    serviceNavigation(page).getByRole("link", { name: SECTIONS.services.name }),
  ).not.toHaveAttribute("aria-current", /.*/);
});

test("breadcrumbs on a tool page take you back to the tools list", async ({ page }) => {
  await page.goto("/tools/canvasly");

  await breadcrumbs(page).getByRole("link", { name: SECTIONS.tools.name }).click();

  await expect(page).toHaveURL(SECTIONS.tools.path);
  await expect(pageContent(page).getByRole("link", { name: "Canvasly" })).toBeVisible();
});

test("you can go from a tool to its vendor and see the vendor's other tools", async ({ page }) => {
  await page.goto("/tools/pipeline-pilot");

  await pageContent(page).getByRole("link", { name: "Kestrel Cloud Ltd" }).click();

  await expect(mainHeading(page)).toHaveText("Kestrel Cloud Ltd");
  await expect(pageContent(page).getByRole("link", { name: "Sentinel Scan" })).toBeVisible();
});

test("you can go from a team to its business unit and on to the unit above it", async ({
  page,
}) => {
  await page.goto("/services/build-tools-team");

  await pageContent(page).getByRole("link", { name: "Developer Experience" }).click();
  await expect(mainHeading(page)).toHaveText("Developer Experience");

  await breadcrumbs(page).getByRole("link", { name: "Digital Platforms" }).click();
  await expect(mainHeading(page)).toHaveText("Digital Platforms");
});

test("the services page groups teams by business unit in their set order", async ({ page }) => {
  await page.goto(SECTIONS.services.path);

  const publicServices = pageContent(page)
    .getByRole("heading", { name: "Public Services" })
    .locator("xpath=following-sibling::ul[1]");
  await expect(publicServices.getByRole("link")).toHaveText([
    "Service Directory",
    "Content Design Community",
  ]);
});

for (const path of [
  "/tools/no-such-tool",
  "/instances/no-such-instance",
  "/capabilities/no-such-capability",
  "/services/no-such-team",
  "/business-units/no-such-unit",
  "/vendors/no-such-vendor",
]) {
  test(`an unknown address shows the page not found page: ${path}`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle(documentTitle(ERROR_PAGES[404].title));
    await expect(mainHeading(page)).toHaveText(ERROR_PAGES[404].title);
  });
}

test.describe("on a large screen", () => {
  test("the contents is always shown", async ({ page }) => {
    await page.goto("/tools/pipeline-pilot");

    await expect(contents(page).getByRole("link", { name: "Team messaging" })).toBeVisible();
    await expect(detailsSummary(contents(page), "Contents")).toBeHidden();
  });
});

test.describe("on a small screen", () => {
  test.use({ viewport: SMALL_SCREEN });

  test("you can open and close the contents", async ({ page }) => {
    await page.goto("/tools/pipeline-pilot");
    const link: Locator = contents(page).getByRole("link", { name: "Team messaging" });
    const toggle: Locator = detailsSummary(contents(page), "Contents");

    await expect(link).toBeHidden();
    await toggle.click();
    await expect(link).toBeVisible();
    await toggle.click();
    await expect(link).toBeHidden();
  });
});
