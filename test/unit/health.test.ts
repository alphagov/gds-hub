import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { silentLogger } from "../../src/lib/logger.js";
import { startApp, testConfig, type RunningApp } from "./helpers.js";

describe("GET /health", () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp(createApp({ config: testConfig, logger: silentLogger }));
  });

  afterAll(async () => {
    await running.close();
  });

  it("reports status, version and uptime", async () => {
    const response = await fetch(`${running.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      status: "ok",
      version: "1.2.3-test",
      uptime: expect.any(Number),
    });
  });

  it("is never cached", async () => {
    const response = await fetch(`${running.baseUrl}/health`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sends security headers", async () => {
    const response = await fetch(`${running.baseUrl}/health`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});
