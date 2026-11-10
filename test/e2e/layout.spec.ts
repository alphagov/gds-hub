import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  documentTitle,
  ERROR_PAGES,
  HOME_PATH,
  SECTIONS,
  SERVICE_NAME,
} from "../../src/site-map.js";

const { tools, capabilities, services, policies } = SECTIONS;

const SMALL_SCREEN = { width: 375, height: 800 } as const;

function serviceNavigation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Menu" });
}

function mainHeading(page: Page): Locator {
  return page.getByRole("heading", { level: 1 });
}

test("the home page shows the service name and the beta banner", async ({ page }) => {
  await page.goto(HOME_PATH);

  await expect(page).toHaveTitle(SERVICE_NAME);
  await expect(mainHeading(page)).toHaveText(SERVICE_NAME);
  await expect(page.locator(".govuk-phase-banner")).toContainText("Beta");
});

test("the header shows the service name and takes you to the home page", async ({ page }) => {
  await page.goto(tools.path);

  const header: Locator = page.getByRole("banner");
  await expect(header).not.toContainText("GOV.UK");
  await header.getByRole("link", { name: SERVICE_NAME, exact: true }).click();

  await expect(page).toHaveURL(HOME_PATH);
  await expect(mainHeading(page)).toHaveText(SERVICE_NAME);
});

test("you can move between sections using the service navigation", async ({ page }) => {
  await page.goto(HOME_PATH);

  await serviceNavigation(page).getByRole("link", { name: capabilities.name }).click();

  await expect(page).toHaveURL(capabilities.path);
  await expect(page).toHaveTitle(documentTitle(capabilities.name));
  await expect(mainHeading(page)).toHaveText(capabilities.name);
});

test("service navigation shows which section you are in", async ({ page }) => {
  await page.goto(tools.path);

  const navigation: Locator = serviceNavigation(page);
  await expect(navigation.getByRole("link", { name: tools.name })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.getByRole("link", { name: services.name })).not.toHaveAttribute(
    "aria-current",
    /.*/,
  );
});

test("breadcrumbs take you back to the home page", async ({ page }) => {
  await page.goto(policies.path);

  const breadcrumbs: Locator = page.getByRole("navigation", { name: "Breadcrumb" });
  await breadcrumbs.getByRole("link", { name: "Home" }).click();

  await expect(page).toHaveURL(HOME_PATH);
  await expect(mainHeading(page)).toHaveText(SERVICE_NAME);
});

test("the skip link is the first thing you reach with the keyboard", async ({ page }) => {
  await page.goto(HOME_PATH);

  await page.keyboard.press("Tab");

  const skipLink: Locator = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#main-content");
});

test("a mistyped address shows the page not found page", async ({ page }) => {
  const response = await page.goto(`${tools.path}-typo`);

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle(documentTitle(ERROR_PAGES[404].title));
  await expect(mainHeading(page)).toHaveText(ERROR_PAGES[404].title);
});

test.describe("with JavaScript", () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, "needs JavaScript");

  test("the skip link moves focus to the main content", async ({ page }) => {
    await page.goto(HOME_PATH);

    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    await expect(page.locator("main#main-content")).toBeFocused();
  });

  test.describe("on a small screen", () => {
    test.use({ viewport: SMALL_SCREEN });

    test("the menu button reveals the navigation", async ({ page }) => {
      await page.goto(HOME_PATH);
      const toolsLink: Locator = serviceNavigation(page).getByRole("link", { name: tools.name });

      await expect(toolsLink).toBeHidden();
      await serviceNavigation(page).getByRole("button", { name: "Menu" }).click();

      await expect(toolsLink).toBeVisible();
    });
  });
});

test.describe("without JavaScript", () => {
  test.skip(({ javaScriptEnabled }) => javaScriptEnabled, "checks the no-JavaScript fallback");

  test.describe("on a small screen", () => {
    test.use({ viewport: SMALL_SCREEN });

    test("the navigation is visible without a menu button", async ({ page }) => {
      await page.goto(HOME_PATH);
      const toolsLink: Locator = serviceNavigation(page).getByRole("link", { name: tools.name });

      await expect(toolsLink).toBeVisible();
      await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    });
  });
});
