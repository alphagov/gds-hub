import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { REDIRECT_CACHE_CONTROL } from "../../src/middleware/redirect-on-not-found.js";
import { silentLogger } from "../../src/lib/logger.js";
import type { RedirectService } from "../../src/services/redirects/redirect-service.js";
import { ERROR_PAGES, TEST_ROUTES } from "../../src/site-map.js";
import { fakeCatalogue } from "./catalogue-fixtures.js";
import { startApp, testConfig, type RunningApp } from "./helpers.js";

let running: RunningApp | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** A redirect service over a fixed list, recording the addresses it was asked about. */
function redirectsOf(redirects: Record<string, string>) {
  const asked: string[] = [];
  const service: RedirectService = {
    newPathFor: (path) => {
      asked.push(path);
      return Promise.resolve(Object.hasOwn(redirects, path) ? redirects[path] : undefined);
    },
  };
  return { service, asked };
}

async function request(
  path: string,
  redirects: RedirectService,
  method = "GET",
): Promise<Response> {
  running = await startApp(
    createApp({ config: testConfig, logger: silentLogger, catalogue: fakeCatalogue(), redirects }),
  );
  return fetch(`${running.baseUrl}${path}`, { method, redirect: "manual" });
}

function titleOf(html: string): string | undefined {
  return /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.trim();
}

describe("old Hub addresses", () => {
  it("redirect permanently to their new page", async () => {
    const { service } = redirectsOf({ "/InfoSec/device-policy.html": "/policies/device-policy" });
    const response = await request("/InfoSec/device-policy.html", service);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/policies/device-policy");
  });

  it("can be cached for a day, so a mistaken redirect can still be corrected", async () => {
    const { service } = redirectsOf({ "/about.html": "/pages/about" });
    const response = await request("/about.html", service);
    expect(response.headers.get("cache-control")).toBe(REDIRECT_CACHE_CONTROL);
    expect(REDIRECT_CACHE_CONTROL).toBe("max-age=86400");
  });

  it("redirect when they look like a page that doesn't exist, such as a tool's old name", async () => {
    const { service } = redirectsOf({ "/tools/old-atlas-name": "/tools/atlas-maker" });
    const response = await request("/tools/old-atlas-name", service);
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/tools/atlas-maker");
  });

  it("redirect HEAD requests too", async () => {
    const { service } = redirectsOf({ "/about.html": "/pages/about" });
    const response = await request("/about.html", service, "HEAD");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/pages/about");
  });

  it("are looked up without their query string, which the redirect drops", async () => {
    const { service, asked } = redirectsOf({ "/about.html": "/pages/about" });
    const response = await request("/about.html?from=bookmark", service);
    expect(asked).toEqual(["/about.html"]);
    expect(response.headers.get("location")).toBe("/pages/about");
  });

  it("aren't redirected for a form submission", async () => {
    const { service, asked } = redirectsOf({ "/about.html": "/pages/about" });
    const response = await request("/about.html", service, "POST");
    expect(response.status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("show the page not found page when there is no redirect", async () => {
    const { service } = redirectsOf({});
    const response = await request("/no-such-page.html", service);
    expect(response.status).toBe(404);
    expect(titleOf(await response.text())).toBe(ERROR_PAGES[404].title);
  });

  it("never hide a page that exists, which always wins", async () => {
    const { service, asked } = redirectsOf({ "/tools/atlas-maker": "/tools/somewhere-else" });
    const response = await request("/tools/atlas-maker", service);
    expect(response.status).toBe(200);
    expect(asked).toEqual([]);
  });

  it("aren't looked up for an error that isn't page not found", async () => {
    const { service, asked } = redirectsOf({ [TEST_ROUTES.error]: "/tools" });
    const response = await request(TEST_ROUTES.error, service);
    expect(response.status).toBe(500);
    expect(asked).toEqual([]);
  });

  it("show the problem page if redirects can't be looked up", async () => {
    const failing: RedirectService = {
      newPathFor: () => Promise.reject(new Error("the database is unavailable")),
    };
    const response = await request("/about.html", failing);
    expect(response.status).toBe(500);
    expect(titleOf(await response.text())).toBe(ERROR_PAGES[500].title);
  });
});
