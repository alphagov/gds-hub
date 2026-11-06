import { expect, test } from "@playwright/test";

test("health check reports the service is up", async ({ request }) => {
  const response = await request.get("/health");

  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({
    status: "ok",
    version: "e2e",
    uptime: expect.any(Number),
  });
});
