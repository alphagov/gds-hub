import { expect, test } from "@playwright/test";

// These tests read the synthetic seed (src/db/seed/seed-data.ts). Run
// `npm run db:reset` before running them locally.

test("a reader opens the policy index, opens a policy and reads it", async ({ page }) => {
  await page.goto("/policies");
  await expect(page.getByRole("heading", { level: 1, name: "Policies" })).toBeVisible();

  await page.getByRole("link", { name: "Software approval policy" }).click();

  await expect(page).toHaveURL(/\/policies\/software-approval$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Software approval policy");
  await expect(page.getByRole("heading", { level: 2, name: "How to apply" })).toBeVisible();
  await expect(page.getByText("Complete a security assessment.")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("a policy shows who owns it, how to contact them and when it was last reviewed", async ({
  page,
}) => {
  await page.goto("/policies/software-approval");

  const details = page.locator(".govuk-summary-list");
  await expect(details).toContainText("Information Security");
  await expect(details.getByRole("link", { name: "infosec@example.com" })).toHaveAttribute(
    "href",
    "mailto:infosec@example.com",
  );
  await expect(details).toContainText("15 July 2026");
});

test("the contents list takes you to a section", async ({ page }) => {
  await page.goto("/policies/software-approval");

  await page
    .getByRole("navigation", { name: "On this page" })
    .getByRole("link", { name: "How to apply" })
    .click();

  await expect(page).toHaveURL(/#how-to-apply$/);
  await expect(page.getByRole("heading", { level: 2, name: "How to apply" })).toBeInViewport();
});

test("the guidance index lists guidance and service guides, and a guide can be read", async ({
  page,
}) => {
  await page.goto("/guidance");

  await expect(page.getByRole("link", { name: "Choosing a collaboration tool" })).toBeVisible();
  await page.getByRole("link", { name: "Setting up a build pipeline" }).click();

  await expect(page).toHaveURL(/\/guidance\/setting-up-a-build-pipeline$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Setting up a build pipeline");
  await expect(page.getByRole("heading", { level: 2, name: "Add a pipeline file" })).toBeVisible();
});

test("a service page lists its guidance", async ({ page }) => {
  await page.goto("/services/build-tools-team");

  await expect(page.getByRole("heading", { level: 2, name: "Guidance" })).toBeVisible();
  await page.getByRole("link", { name: "Setting up a build pipeline" }).click();

  await expect(page).toHaveURL(/\/guidance\/setting-up-a-build-pipeline$/);
});

test("a draft guide is not shown", async ({ page }) => {
  await page.goto("/services/incident-response-team");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Incident Response Team");
  await expect(page.getByText("On-call handbook")).toHaveCount(0);

  await page.goto("/guidance");
  await expect(page.getByText("On-call handbook")).toHaveCount(0);

  const response = await page.goto("/guidance/on-call-handbook");
  expect(response?.status()).toBe(404);
});

test("a page that doesn't exist shows page not found", async ({ page }) => {
  const response = await page.goto("/policies/no-such-policy");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});

test("an old Hub address takes you to its policy", async ({ page }) => {
  await page.goto("/InfoSec/software-approval.html");

  await expect(page).toHaveURL(/\/policies\/software-approval$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Software approval policy");
});
