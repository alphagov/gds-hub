import { expect, test } from "@playwright/test";

// These tests read the synthetic seed (src/db/seed/seed-data.ts), which has a
// redirect from an old Hub address to the Pipeline Pilot tool page. Run
// `npm run db:reset` before running them locally.

test("an old Hub address takes you to its new page", async ({ page }) => {
  await page.goto("/tools/pipeline-pilot-ci/");

  await expect(page).toHaveURL(/\/tools\/pipeline-pilot$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pipeline Pilot");
});
