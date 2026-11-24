import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Runs in the "migrated" project only (see playwright.config.ts): pages made
// from the synthetic migration fixtures, which use markup the seed doesn't,
// such as tables and ordered lists inside lists.

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const [name, path] of [
  ["policy", "/policies/device-policy"],
  ["guidance page", "/guidance/widgets"],
  ["service guide", "/guidance/kettle-guide"],
] as const) {
  test(`the migrated ${name} has no accessibility violations`, async ({ page }) => {
    await page.goto(path);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    expect(results.violations).toEqual([]);
  });
}
