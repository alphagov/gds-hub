/// <reference lib="dom" />
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

// Preview through the unauthenticated test mode editing pages, against the
// synthetic seed. Each test makes its own vendor, so reruns and the
// with-JavaScript and without-JavaScript runs don't clash.

const NOT_SAVED = /preview.*not saved|not saved.*preview/is;
let counter = 0;

function unique(): { slug: string; name: string } {
  counter += 1;
  const project = test.info().project.name.replace(/[^a-z]/g, "");
  const stamp = `${Date.now().toString(36)}-${counter}`;
  return { slug: `preview-${project}-${stamp}`, name: `Preview ${project} ${stamp}` };
}

async function addVendor(page: Page, slug: string, name: string): Promise<void> {
  await page.goto("/edit/vendors/new");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Description").fill("The saved description.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/created/i).first()).toBeVisible();
}

test("preview shows the new text without saving it", async ({ page }) => {
  const { slug, name } = unique();
  await addVendor(page, slug, name);
  const auditBefore = await auditCount(slug);

  await page.getByLabel("Description").fill("Text that is only a preview.");
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.locator(".govuk-notification-banner")).toContainText(NOT_SAVED);
  await expect(page.getByText("Text that is only a preview.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);

  const live = await page.goto(`/vendors/${slug}`);
  expect(live?.status()).toBe(200);
  await expect(page.getByText("The saved description.")).toBeVisible();
  await expect(page.getByText("Text that is only a preview.")).toHaveCount(0);
  expect(await auditCount(slug)).toBe(auditBefore);
});

test("save and publish from a preview saves what was previewed", async ({ page }) => {
  const { slug, name } = unique();
  await addVendor(page, slug, name);

  await page.getByLabel("Description").fill("Published from a preview.");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Save and publish" }).click();

  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
  await page.goto(`/vendors/${slug}`);
  await expect(page.getByText("Published from a preview.")).toBeVisible();
});

test("continue editing goes back to the form with what you typed", async ({ page }) => {
  const { slug, name } = unique();
  await addVendor(page, slug, name);

  await page.getByLabel("Description").fill("Typed before previewing.");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Continue editing" }).click();

  await expect(page.getByLabel("Description")).toHaveValue("Typed before previewing.");
  await page.goto(`/vendors/${slug}`);
  await expect(page.getByText("Typed before previewing.")).toHaveCount(0);
});

test("a preview of a record that has not been added yet saves it only when you choose", async ({
  page,
}) => {
  const { slug, name } = unique();
  await page.goto("/edit/vendors/new");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.locator(".govuk-notification-banner")).toContainText(NOT_SAVED);
  expect((await page.request.get(`/vendors/${slug}`)).status()).toBe(404);

  await page.getByRole("button", { name: "Save and publish" }).click();
  expect((await page.request.get(`/vendors/${slug}`)).status()).toBe(200);
});

test("a changed payload is refused and nothing is saved", async ({ page }) => {
  test.skip(
    test.info().project.use.javaScriptEnabled === false,
    "changes the hidden field through the page, which needs JavaScript",
  );
  const { slug, name } = unique();
  await addVendor(page, slug, name);
  await page.getByLabel("Description").fill("Honest text.");
  await page.getByRole("button", { name: "Preview" }).click();
  const auditBefore = await auditCount(slug);

  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>("input[name=preview]");
    if (field) field.value = `${field.value.slice(0, -3)}AAA`;
  });
  await page.getByRole("button", { name: "Save and publish" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto(`/vendors/${slug}`);
  await expect(page.getByText("Honest text.")).toHaveCount(0);
  expect(await auditCount(slug)).toBe(auditBefore);
});

test("a preview with mistakes shows what is wrong and keeps what you typed", async ({ page }) => {
  await page.goto("/edit/vendors/new");
  await page.getByLabel("Slug").fill("Not A Slug");
  await page.getByLabel("Description").fill("Words that must survive.");
  await page.getByRole("button", { name: "Preview" }).click();

  await expect(page.getByRole("heading", { name: "There is a problem" })).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue("Words that must survive.");
  await expect(page.locator(".govuk-notification-banner")).toHaveCount(0);
});

test("the preview page passes the accessibility checks", async ({ page }) => {
  test.skip(test.info().project.use.javaScriptEnabled === false, "axe needs JavaScript");
  const { slug, name } = unique();
  await addVendor(page, slug, name);
  await page.getByRole("button", { name: "Preview" }).click();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

test("a preview is not cached or indexed", async ({ page }) => {
  const { slug, name } = unique();
  await addVendor(page, slug, name);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/preview") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Preview" }).click(),
  ]);

  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["x-robots-tag"]).toMatch(/noindex/);
});

/**
 * How many audit rows exist for the record with this slug, counted directly so the test
 * doesn't rely on the app to say nothing was written.
 */
async function auditCount(slug: string): Promise<number> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "SELECT count(*) FROM audit_log WHERE after->>'slug' = $1 OR before->>'slug' = $1",
      [slug],
    );
    return Number(result.rows[0]?.count);
  } finally {
    await client.end();
  }
}
