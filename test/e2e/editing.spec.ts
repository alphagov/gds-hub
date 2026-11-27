import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// These tests read and change the synthetic seed (src/db/seed/seed-data.ts)
// through the unauthenticated test mode editing pages, which the e2e server
// switches on (EDIT_MODE=test in playwright.config.ts). Each test makes its
// own records, with names that are unique to the project, so a rerun on the
// same database and the with-JavaScript and without-JavaScript runs don't clash.

const WARNING = /test mode.*not signed in/i;

let counter = 0;

function unique(prefix: string): { slug: string; name: string } {
  counter += 1;
  const project = test.info().project.name.replace(/[^a-z]/g, "");
  const slug = `${prefix}-${project}-${Date.now().toString(36)}-${counter}`;
  return { slug, name: `${prefix} ${project} ${Date.now().toString(36)} ${counter}` };
}

async function addVendor(page: Page, name: string, slug: string): Promise<void> {
  await page.goto("/edit/vendors/new");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Save" }).click();
}

test("every edit page says you are not signed in", async ({ page }) => {
  for (const path of ["/edit", "/edit/vendors", "/edit/vendors/new", "/edit/pages/new"]) {
    await page.goto(path);

    await expect(page.getByText(WARNING).first(), path).toBeVisible();
  }
});

test("you can find the edit pages and choose what to edit", async ({ page }) => {
  await page.goto("/edit");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Tools and Services are also in the service navigation, so look in the page itself.
  const main = page.getByRole("main");
  for (const label of ["Pages", "Tools", "Instances", "Vendors", "Services"]) {
    await expect(main.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  await main.getByRole("link", { name: "Vendors", exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/vendors$/);
  await expect(page.getByRole("link", { name: /Kestrel Cloud/ })).toBeVisible();
});

test("an editor adds a policy and readers can read it", async ({ page }) => {
  const { slug, name } = unique("policy");

  await page.goto("/edit/pages/new");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Title").fill(name);
  await page.getByLabel("Page type").selectOption("policy");
  await page.getByLabel("Summary").fill("A short summary typed in a test.");
  await page.getByLabel("Body").fill("## First section\n\nSome **important** words.");
  await page.getByLabel("Status").selectOption("published");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/created/i).first()).toBeVisible();
  await expect(page.getByText(WARNING).first()).toBeVisible();

  await page.goto(`/policies/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page.getByRole("heading", { level: 2, name: "First section" })).toBeVisible();
  await expect(page.getByText("important")).toBeVisible();
});

test("an editor changes a record and the change shows on the page", async ({ page }) => {
  const { slug, name } = unique("vendor");
  await addVendor(page, name, slug);
  await expect(page.getByText(/created/i).first()).toBeVisible();

  await page.getByLabel("Description").fill("Added by an editing test.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();
  await page.goto(`/vendors/${slug}`);
  await expect(page.getByText("Added by an editing test.")).toBeVisible();
});

test("a draft page is saved but not shown to readers", async ({ page }) => {
  const { slug, name } = unique("draft");

  await page.goto("/edit/pages/new");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Title").fill(name);
  await page.getByLabel("Page type").selectOption("guidance");
  await page.getByLabel("Body").fill("Not ready.");
  await page.getByLabel("Status").selectOption("draft");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/created/i).first()).toBeVisible();

  const response = await page.goto(`/guidance/${slug}`);
  expect(response?.status()).toBe(404);
});

test("the form shows what is wrong and keeps what you typed", async ({ page }) => {
  await page.goto("/edit/vendors/new");
  await page.getByLabel("Slug").fill("Not A Slug");
  await page.getByLabel("Web address").fill("javascript:alert(1)");
  await page.getByLabel("Description").fill("Words that must survive.");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("heading", { name: "There is a problem" })).toBeVisible();
  await expect(page.getByRole("link", { name: /slug/i }).first()).toBeVisible();
  await expect(page.getByLabel("Slug")).toHaveValue("Not A Slug");
  await expect(page.getByLabel("Description")).toHaveValue("Words that must survive.");
  await expect(page.getByText(WARNING).first()).toBeVisible();
});

test("the error summary link takes you to the field", async ({ page }) => {
  await page.goto("/edit/vendors/new");
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("link", { name: /name/i }).first().click();

  // With JavaScript, GOV.UK Frontend moves focus to the field instead of
  // changing the address. Without it, the link goes to the field's id.
  if (test.info().project.use.javaScriptEnabled === false) {
    await expect(page).toHaveURL(/#name$/);
  } else {
    await expect(page.getByLabel("Name")).toBeFocused();
  }
});

test("an editor deletes a record after confirming", async ({ page }) => {
  const { slug, name } = unique("vendor");
  await addVendor(page, name, slug);
  await expect(page.getByText(/created/i).first()).toBeVisible();

  await page.getByRole("link", { name: /delete/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/delete/i);
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByRole("button", { name: /delete/i }).click();

  await expect(page).toHaveURL(/\/edit\/vendors\?saved=deleted$/);
  await expect(page.getByText(/deleted/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});

test("cancelling a delete leaves the record", async ({ page }) => {
  const { slug, name } = unique("vendor");
  await addVendor(page, name, slug);

  await page.getByRole("link", { name: /delete/i }).click();
  await page.getByRole("link", { name: /cancel|back/i }).click();

  await page.goto("/edit/vendors");
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("a record that is still in use can't be deleted", async ({ page }) => {
  await page.goto("/edit/vendors");
  await page.getByRole("link", { name: /Kestrel Cloud/ }).click();
  await page.getByRole("link", { name: /delete/i }).click();
  await page.getByRole("button", { name: /delete/i }).click();

  await expect(page.getByText(/still (used|in use)|can.t be deleted/i).first()).toBeVisible();
  await page.goto("/vendors/kestrel-cloud");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kestrel Cloud Ltd");
});

test("a second editor with an out-of-date form is told, and nothing is overwritten", async ({
  page,
  browser,
}) => {
  const { slug, name } = unique("vendor");
  await addVendor(page, name, slug);
  await expect(page.getByText(/created/i).first()).toBeVisible();
  const editUrl = page.url().split("?")[0] ?? "";

  const other = await browser.newContext({
    javaScriptEnabled: test.info().project.use.javaScriptEnabled !== false,
  });
  const otherPage = await other.newPage();
  await otherPage.goto(editUrl);

  await page.getByLabel("Description").fill("The first editor's words.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/saved|updated/i).first()).toBeVisible();

  await otherPage.getByLabel("Description").fill("The second editor's words.");
  await otherPage.getByRole("button", { name: "Save" }).click();

  await expect(otherPage.getByText(/changed (by someone else|since)/i).first()).toBeVisible();
  await expect(otherPage.getByLabel("Description")).toHaveValue("The second editor's words.");
  await page.goto(`/vendors/${slug}`);
  await expect(page.getByText("The first editor's words.")).toBeVisible();
  await other.close();
});

test.describe("accessibility of the editing pages", () => {
  test.skip(({ javaScriptEnabled }) => !javaScriptEnabled, "axe needs JavaScript");

  const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

  test("the form with errors, the delete confirmation and a saved record have no violations", async ({
    page,
  }) => {
    await page.goto("/edit/vendors/new");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "There is a problem" })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

    const { slug, name } = unique("vendor");
    await addVendor(page, name, slug);
    await expect(page.getByText(/created/i).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);

    await page.getByRole("link", { name: /delete/i }).click();
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations).toEqual([]);
  });
});
