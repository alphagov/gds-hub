import { expect, test } from "@playwright/test";

// These tests run in the "migrated" project, against an app whose database was
// loaded from the synthetic fixtures in test/fixtures/migration (see
// test/e2e/support/serve-migrated.ts). The content is invented.

test("a migrated policy renders", async ({ page }) => {
  await page.goto("/policies/device-policy");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Example device policy");
  await expect(page.getByRole("heading", { level: 2, name: "Scope" })).toBeVisible();
  await expect(page.getByText("keep example software up to date")).toBeVisible();
});

test("migrated guidance renders", async ({ page }) => {
  await page.goto("/guidance/widgets");

  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Page not found");
  await expect(page.getByRole("main")).toContainText("Widgets");
});

test("a migrated service guide renders", async ({ page }) => {
  await page.goto("/guidance/kettle-guide");

  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Page not found");
});

test("an old Hub address takes you to its migrated page", async ({ page }) => {
  await page.goto("/InfoSec/device-policy.html");
  await expect(page).toHaveURL(/\/policies\/device-policy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Example device policy");

  await page.goto("/old-widgets.html");
  await expect(page).toHaveURL(/\/guidance\/widgets$/);
});
