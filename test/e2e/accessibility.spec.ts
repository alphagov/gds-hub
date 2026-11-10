import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { HOME_PATH, SECTION_LIST, TEST_ROUTES } from "../../src/site-map.js";

// axe's tags aren't cumulative: WCAG 2.2 AA needs the level A and AA rules
// from every version.
const WCAG_TAGS: readonly string[] = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface PageUnderTest {
  readonly name: string;
  readonly path: string;
}

const PAGES: readonly PageUnderTest[] = [
  { name: "home", path: HOME_PATH },
  ...SECTION_LIST.map(({ name, path }) => ({ name: name.toLowerCase(), path })),
  { name: "page not found", path: "/no-such-page" },
  { name: "forbidden", path: TEST_ROUTES.forbidden },
  { name: "server error", path: TEST_ROUTES.error },
];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();

  expect(results.violations).toEqual([]);
}

/**
 * Stops the page's own scripts from running, so it renders exactly as it does
 * with JavaScript turned off. axe still runs, because Playwright evaluates it
 * outside the page's Content-Security-Policy.
 */
async function blockPageScripts(route: Route): Promise<void> {
  if (route.request().resourceType() !== "document") {
    await route.continue();
    return;
  }
  const response = await route.fetch();
  await route.fulfill({
    response,
    headers: { ...response.headers(), "content-security-policy": "script-src 'none'" },
  });
}

test.describe("with JavaScript", () => {
  for (const { name, path } of PAGES) {
    test(`the ${name} page has no accessibility violations`, async ({ page }) => {
      await page.goto(path);

      await expectNoViolations(page);
    });
  }
});

test.describe("without JavaScript", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/*", blockPageScripts);
  });

  for (const { name, path } of PAGES) {
    test(`the ${name} page has no accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("body")).not.toHaveClass(/js-enabled/);

      await expectNoViolations(page);
    });
  }
});
