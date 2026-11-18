import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import type { Config } from "../../src/config.js";
import { silentLogger } from "../../src/lib/logger.js";
import {
  ASSET_PATHS,
  HOME_PATH,
  SECTION_LIST,
  SECTIONS,
  SERVICE_NAME,
  TEST_ROUTES,
  type Section,
} from "../../src/site-map.js";
import { fakeCatalogue } from "./catalogue-fixtures.js";
import { noRedirects, startApp, testConfig, type RunningApp } from "./helpers.js";

function headingOf(html: string): string | undefined {
  return /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.trim();
}

describe("app", () => {
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp(
      createApp({
        config: testConfig,
        logger: silentLogger,
        catalogue: fakeCatalogue(),
        redirects: noRedirects,
      }),
    );
  });

  afterAll(async () => {
    await running.close();
  });

  function get(path: string): Promise<Response> {
    return fetch(`${running.baseUrl}${path}`);
  }

  describe("pages", () => {
    it("renders the home page", async () => {
      const response: Response = await get(HOME_PATH);
      const html: string = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^text\/html/);
      expect(headingOf(html)).toBe(SERVICE_NAME);
      expect(html).toMatch(new RegExp(`<title[^>]*>\\s*${SERVICE_NAME}\\s*</title>`));
    });

    it("links to every section from the home page", async () => {
      const html: string = await (await get(HOME_PATH)).text();

      for (const section of SECTION_LIST) {
        expect(html).toContain(`href="${section.path}"`);
      }
    });

    it.each(SECTION_LIST)("renders the $name section page", async (section: Section) => {
      const response: Response = await get(section.path);
      const html: string = await response.text();

      expect(response.status).toBe(200);
      expect(headingOf(html)).toBe(section.name);
      expect(html).toContain("govuk-breadcrumbs");
    });

    it("stops the search page from being cached", async () => {
      const response: Response = await get(SECTIONS.search.path);

      expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("still answers the health check with JSON", async () => {
      const response: Response = await get("/health");

      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    });
  });

  describe("content security policy", () => {
    it("allows the inline script only through a nonce that changes on every request", async () => {
      const nonces: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const response: Response = await get(HOME_PATH);
        const html: string = await response.text();
        const csp: string = response.headers.get("content-security-policy") ?? "";
        const nonce: string | undefined = /<script nonce="([^"]+)">/.exec(html)?.[1];

        expect(nonce).toBeDefined();
        expect(csp).toContain(`'nonce-${nonce ?? ""}'`);
        expect(csp).toMatch(/script-src [^;]*'nonce-/);
        expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
        nonces.push(nonce ?? "");
      }
      expect(nonces[0]).not.toBe(nonces[1]);
    });
  });

  describe("assets", () => {
    it("serves the GOV.UK Frontend stylesheet", async () => {
      const response: Response = await get(ASSET_PATHS.stylesheet);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^text\/css/);
    });

    it("answers an unsatisfiable range request for the stylesheet with a 416", async () => {
      const response: Response = await fetch(`${running.baseUrl}${ASSET_PATHS.stylesheet}`, {
        headers: { range: "bytes=999999999-" },
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toMatch(/^bytes \*\/\d+$/);
    });

    it("serves the fonts the stylesheet refers to", async () => {
      const css: string = await (await get(ASSET_PATHS.stylesheet)).text();
      const fontUrl = new RegExp(`url\\(["']?(${ASSET_PATHS.assets}/fonts/[^"')]+\\.woff2)`);
      const fontPath: string | undefined = fontUrl.exec(css)?.[1];

      expect(fontPath).toBeDefined();
      const response: Response = await get(fontPath ?? "");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toMatch(/^font\/woff2/);
    });

    it("serves the GOV.UK Frontend script and the application script", async () => {
      for (const path of [ASSET_PATHS.frontendScript, ASSET_PATHS.applicationScript]) {
        const response: Response = await get(path);
        expect(response.status, path).toBe(200);
        expect(response.headers.get("content-type")).toMatch(/^(text|application)\/javascript/);
      }
    });

    it("serves the favicon and web manifest", async () => {
      for (const file of ["images/favicon.svg", "manifest.json"]) {
        const response: Response = await get(`${ASSET_PATHS.assets}/${file}`);
        expect(response.status, file).toBe(200);
      }
    });

    it("does not serve package files outside the assets", async () => {
      for (const file of ["template.njk", "index.scss", "../package.json", "%2e%2e/package.json"]) {
        const response: Response = await get(`${ASSET_PATHS.assets}/${file}`);
        expect(response.status, file).toBe(404);
      }
    });
  });

  describe("test-only routes", () => {
    it("are available in the test environment", async () => {
      expect((await get(TEST_ROUTES.forbidden)).status).toBe(403);
      expect((await get(TEST_ROUTES.error)).status).toBe(500);
    });

    it.each(["production", "development"] as const)(
      "do not exist in %s",
      async (nodeEnv: Config["nodeEnv"]) => {
        const config: Config = { ...testConfig, nodeEnv };
        const other: RunningApp = await startApp(
          createApp({
            config,
            logger: silentLogger,
            catalogue: fakeCatalogue(),
            redirects: noRedirects,
          }),
        );
        try {
          expect((await fetch(`${other.baseUrl}${TEST_ROUTES.forbidden}`)).status).toBe(404);
          expect((await fetch(`${other.baseUrl}${TEST_ROUTES.error}`)).status).toBe(404);
        } finally {
          await other.close();
        }
      },
    );
  });
});
