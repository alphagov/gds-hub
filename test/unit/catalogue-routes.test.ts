import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { silentLogger } from "../../src/lib/logger.js";
import type { CatalogueService } from "../../src/services/catalogue/catalogue-service.js";
import { ERROR_PAGES, HOME_PATH, SECTIONS } from "../../src/site-map.js";
import { fakeCatalogue } from "./catalogue-fixtures.js";
import { startApp, testConfig, type RunningApp } from "./helpers.js";

let running: RunningApp | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function get(path: string, catalogue: CatalogueService = fakeCatalogue()): Promise<Response> {
  running = await startApp(createApp({ config: testConfig, logger: silentLogger, catalogue }));
  return fetch(`${running.baseUrl}${path}`);
}

function headingOf(html: string): string | undefined {
  return /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.trim();
}

/** The opening tag of the service navigation link to `href`. */
function navigationLink(html: string, href: string): string {
  const navigation = /<nav[^>]*aria-label="Menu"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
  return new RegExp(`<a[^>]*href="${href}"[^>]*>`).exec(navigation)?.[0] ?? "";
}

const PAGES = [
  { name: "home", path: HOME_PATH, heading: "GDS Hub" },
  { name: "capabilities", path: SECTIONS.capabilities.path, heading: "Capabilities" },
  { name: "capability", path: "/capabilities/map-making", heading: "Map making" },
  { name: "tools", path: SECTIONS.tools.path, heading: "Tools" },
  { name: "tool", path: "/tools/atlas-maker", heading: "Atlas Maker" },
  { name: "instance", path: "/instances/atlas-maker-main", heading: "Atlas Maker main workspace" },
  { name: "vendor", path: "/vendors/compass-co", heading: "Compass Co" },
  { name: "services", path: SECTIONS.services.path, heading: "Services" },
  { name: "product, team or service", path: "/services/mapping-team", heading: "Mapping Team" },
  { name: "business unit", path: "/business-units/exploration", heading: "Exploration" },
  { name: "policies placeholder", path: SECTIONS.policies.path, heading: "Policies" },
] as const;

describe("catalogue pages", () => {
  it.each(PAGES)("renders the $name page with the contents", async ({ path, heading }) => {
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(headingOf(html)).toBe(heading);
    expect(html).toContain('<nav class="app-contents" aria-label="Contents">');
    expect(html).toContain('href="/capabilities/map-making"');
  });

  it("does not list hidden capabilities in the contents", async () => {
    const html = await (await get(HOME_PATH)).text();

    expect(html).not.toContain("Secret passages");
  });

  it("marks the capability whose page it is in the contents", async () => {
    const html = await (await get("/capabilities/map-making")).text();

    expect(html).toMatch(/href="\/capabilities\/map-making" aria-current="page"/);
    expect(html).not.toMatch(/href="\/capabilities\/globe-spinning" aria-current/);
  });

  it.each([
    ["/instances/atlas-maker-main", SECTIONS.tools.path],
    ["/vendors/compass-co", SECTIONS.tools.path],
    ["/business-units/exploration", SECTIONS.services.path],
    ["/capabilities/map-making", SECTIONS.capabilities.path],
  ])("marks the right section in the service navigation on %s", async (path, sectionPath) => {
    const html = await (await get(path)).text();

    expect(navigationLink(html, sectionPath)).toContain('aria-current="true"');
  });

  it("shows how to get access on the tool page, with the migration status", async () => {
    const html = await (await get("/tools/atlas-maker")).text();

    expect(html).toContain("How to get access");
    expect(html).toMatch(/govuk-details__summary-text">\s*Getting access\s*</);
    expect(html).toContain("Ask in the #atlas channel.");
    expect(html).toMatch(
      /Migration to DSIT identity[\s\S]*?govuk-tag govuk-tag--grey">\s*Not started/,
    );
  });

  it("is cacheable", async () => {
    const response = await get("/tools/atlas-maker");

    expect(response.headers.get("cache-control")).toBeNull();
  });
});

describe("unknown records", () => {
  it.each([
    "/capabilities/no-such-capability",
    "/tools/no-such-tool",
    "/instances/no-such-instance",
    "/vendors/no-such-vendor",
    "/services/no-such-team",
    "/business-units/no-such-unit",
  ])("shows the page not found page for %s", async (path) => {
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(headingOf(html)).toBe(ERROR_PAGES[404].title);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    "/tools/Atlas-Maker",
    "/tools/atlas_maker",
    "/tools/atlas--maker",
    "/tools/-atlas",
    `/tools/${"a".repeat(161)}`,
  ])("shows the page not found page for %s without looking it up", async (path) => {
    const tool = vi.fn(() => Promise.resolve(undefined));
    const capabilityGroups = vi.fn(() => Promise.resolve([]));

    const response = await get(path, fakeCatalogue({ tool, capabilityGroups }));

    expect(response.status).toBe(404);
    expect(tool).not.toHaveBeenCalled();
    expect(capabilityGroups).not.toHaveBeenCalled();
  });
});

describe("when the catalogue fails", () => {
  it("shows the server error page", async () => {
    const response = await get(
      "/tools/atlas-maker",
      fakeCatalogue({ tool: () => Promise.reject(new Error("database unavailable")) }),
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(headingOf(html)).toBe(ERROR_PAGES[500].title);
    expect(html).not.toContain("database unavailable");
  });

  it("shows the server error page when the contents can't be loaded", async () => {
    const response = await get(
      HOME_PATH,
      fakeCatalogue({ capabilityGroups: () => Promise.reject(new Error("database unavailable")) }),
    );

    expect(response.status).toBe(500);
  });
});

describe("with no capabilities", () => {
  it("shows the page without the contents", async () => {
    const empty = fakeCatalogue({ capabilityGroups: () => Promise.resolve([]) });

    const html = await (await get(HOME_PATH, empty)).text();

    expect(html).not.toContain("app-contents");
    expect(html).toContain("No capabilities have been added yet.");
  });
});
