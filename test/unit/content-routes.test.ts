import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { silentLogger } from "../../src/lib/logger.js";
import type { ContentService } from "../../src/services/content/content-service.js";
import { ERROR_PAGES, SECTIONS } from "../../src/site-map.js";
import { fakeCatalogue } from "./catalogue-fixtures.js";
import { fakeContent, mappingTeam, pageDetail } from "./content-fixtures.js";
import { noRedirects, startApp, testConfig, type RunningApp } from "./helpers.js";
import type { RedirectService } from "../../src/services/redirects/redirect-service.js";

let running: RunningApp | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function get(
  path: string,
  content: ContentService = fakeContent(),
  redirects: RedirectService = noRedirects,
): Promise<Response> {
  // A test can make several requests: close the app the last one started.
  await running?.close();
  running = await startApp(
    createApp({
      config: testConfig,
      logger: silentLogger,
      catalogue: fakeCatalogue(),
      content,
      redirects,
    }),
  );
  return fetch(`${running.baseUrl}${path}`, { redirect: "manual" });
}

function headingOf(html: string): string | undefined {
  return /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.trim();
}

describe("the policies listing", () => {
  it("lists published policies, in title order, with their summary and last reviewed date", async () => {
    const response = await get(SECTIONS.policies.path);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(headingOf(html)).toBe("Policies");
    expect(html).toContain('href="/policies/cake-rules"');
    expect(html).toContain('href="/policies/device-rules"');
    expect(html.indexOf("Cake rules")).toBeLessThan(html.indexOf("Device rules"));
    expect(html).toContain("What you can connect to the invented network.");
    expect(html).toContain("15 July 2026");
  });

  it("does not list guidance, drafts or other kinds of page", async () => {
    const html = await (await get(SECTIONS.policies.path)).text();

    expect(html).not.toContain("Choosing a pen");
    expect(html).not.toContain("Mapping quickstart");
    expect(html).not.toContain("About us");
  });

  it("says so when there are no policies", async () => {
    const html = await (await get(SECTIONS.policies.path, fakeContent([]))).text();

    expect(html).toContain("There are no policies yet.");
  });

  it("marks Policies in the service navigation and keeps the contents", async () => {
    const html = await (await get(SECTIONS.policies.path)).text();

    expect(html).toMatch(/<a[^>]*href="\/policies"[^>]*aria-current="page"/);
    expect(html).toContain('aria-label="Contents"');
  });

  it("marks Policies in the service navigation on a policy page", async () => {
    const html = await (await get("/policies/device-rules")).text();

    expect(html).toMatch(/<a[^>]*href="\/policies"[^>]*aria-current="true"/);
  });
});

describe("the guidance listing", () => {
  it("lists published guidance and service guides, and nothing else", async () => {
    const html = await (await get(SECTIONS.guidance.path)).text();

    expect(headingOf(html)).toBe("Guidance");
    expect(html).toContain('href="/guidance/choosing-a-pen"');
    expect(html).toContain('href="/guidance/mapping-quickstart"');
    expect(html).not.toContain("draft-guide");
    expect(html).not.toContain("Device rules");
    expect(html).not.toContain("About us");
  });
});

describe("a policy page", () => {
  it("shows the title, summary, rendered body, owner, contact and last reviewed date", async () => {
    const response = await get("/policies/device-rules");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(headingOf(html)).toBe("Device rules");
    expect(html).toContain("What you can connect to the invented network.");
    expect(html).toContain("<strong>laptops</strong>");
    expect(html).toContain("Information Security");
    expect(html).toContain('href="mailto:infosec@example.com"');
    expect(html).toContain("15 July 2026");
    expect(html).toContain("<title>Device rules - GDS Hub</title>");
  });

  it("lists the h2 headings under 'On this page', linking to their ids", async () => {
    const html = await (await get("/policies/device-rules")).text();

    expect(html).toMatch(/<nav[^>]*aria-label="On this page"/);
    expect(html).toContain('href="#scope"');
    expect(html).toContain('href="#exceptions"');
    expect(html).toContain('id="scope"');
  });

  it("leaves out 'On this page' when there are no h2 headings", async () => {
    const content = fakeContent([pageDetail({ bodyMarkdown: "Just a paragraph." })]);
    const html = await (await get("/policies/device-rules", content)).text();

    expect(html).not.toContain("On this page");
  });

  it("has only one navigation with each accessible name", async () => {
    const html = await (await get("/policies/device-rules")).text();
    const names = [...html.matchAll(/<nav[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);

    expect(new Set(names).size).toBe(names.length);
  });

  it("shows 'Not recorded' when there's no review date, and leaves out a missing owner and contact", async () => {
    const content = fakeContent([
      pageDetail({ lastReviewedAt: null, ownerName: null, ownerContact: null }),
    ]);
    const html = await (await get("/policies/device-rules", content)).text();

    expect(html).toContain("Not recorded");
    expect(html).not.toContain("Owner");
    expect(html).not.toContain("Contact");
  });

  it("shows a contact that isn't an email address as text, not a link", async () => {
    const content = fakeContent([pageDetail({ ownerContact: "#infosec on Chatterbox" })]);
    const html = await (await get("/policies/device-rules", content)).text();

    expect(html).toContain("#infosec on Chatterbox");
    expect(html).not.toContain("mailto:");
  });

  it("links the owner to the owning team when there is one", async () => {
    const content = fakeContent([
      pageDetail({ slug: "device-rules", ownerName: "Mapping Team" }, mappingTeam),
    ]);
    const html = await (await get("/policies/device-rules", content)).text();

    expect(html).toContain('href="/services/mapping-team"');
  });

  it("escapes the title, summary and owner", async () => {
    const content = fakeContent([
      pageDetail({
        title: "<img src=x onerror=alert(1)>",
        summary: "<script>alert(2)</script>",
        ownerName: "<b>Owner</b>",
      }),
    ]);
    const html = await (await get("/policies/device-rules", content)).text();

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(html).not.toContain("<b>Owner</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("sanitises the body", async () => {
    const content = fakeContent([
      pageDetail({
        bodyMarkdown: '## Hello\n\n<script>alert(1)</script><a href="javascript:alert(1)">x</a>',
      }),
    ]);
    const html = await (await get("/policies/device-rules", content)).text();

    expect(html).not.toMatch(/<script[^>]*>[^<]*alert/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("alert(1)");
  });
});

describe("a guidance page", () => {
  it("shows guidance and service guides", async () => {
    for (const [slug, title] of [
      ["choosing-a-pen", "Choosing a pen"],
      ["mapping-quickstart", "Mapping quickstart"],
    ]) {
      const response = await get(`/guidance/${slug}`);

      expect(response.status).toBe(200);
      expect(headingOf(await response.text())).toBe(title);
    }
  });
});

describe("pages that aren't there", () => {
  it.each([
    ["a draft", "/guidance/draft-guide"],
    ["a page of another type", "/policies/choosing-a-pen"],
    ["a policy under guidance", "/guidance/device-rules"],
    ["a general page under policies", "/policies/about-us"],
    ["an unknown slug", "/policies/no-such-policy"],
    ["a slug that isn't kebab case", "/policies/Device_Rules"],
    ["a slug with a path in it", "/policies/..%2Fsecret"],
    ["a very long slug", `/policies/${"a".repeat(500)}`],
    ["the old what's new address", "/whats-new/new-online-whiteboard-licences"],
    ["the old general pages address", "/pages/about-us"],
  ])("show the page not found page for %s", async (_name, path) => {
    const response = await get(path);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(headingOf(html)).toBe(ERROR_PAGES[404].title);
  });

  it("does not query the content service for a malformed slug", async () => {
    const asked: string[] = [];
    const content: ContentService = {
      ...fakeContent(),
      page: (_section, slug) => {
        asked.push(slug);
        return Promise.resolve(undefined);
      },
    };

    await get("/policies/Not_A_Slug", content);

    expect(asked).toEqual([]);
  });

  it("still redirects an old address after finding no page", async () => {
    const redirects: RedirectService = {
      newPathFor: (path) =>
        Promise.resolve(
          path === "/InfoSec/software-approval.html" ? "/policies/device-rules" : undefined,
        ),
    };

    const response = await get("/InfoSec/software-approval.html", fakeContent(), redirects);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/policies/device-rules");
  });

  it("gives the 500 page if the content service fails", async () => {
    const content: ContentService = {
      ...fakeContent(),
      pages: () => Promise.reject(new Error("database down")),
    };

    const response = await get(SECTIONS.policies.path, content);

    expect(response.status).toBe(500);
  });
});

describe("a service page's guidance", () => {
  it("lists that team's published service guides", async () => {
    const html = await (await get("/services/mapping-team")).text();

    expect(html).toContain("Guidance");
    expect(html).toContain('href="/guidance/mapping-quickstart"');
    expect(html).toContain("Mapping quickstart");
  });

  it("does not list drafts, other teams' guides or other kinds of page", async () => {
    const content = fakeContent([
      pageDetail(
        {
          id: 4,
          slug: "mapping-quickstart",
          title: "Mapping quickstart",
          pageType: "service_guide",
        },
        mappingTeam,
      ),
      pageDetail(
        {
          id: 5,
          slug: "draft-guide",
          title: "Secret draft",
          status: "draft",
          pageType: "service_guide",
        },
        mappingTeam,
      ),
      pageDetail(
        { id: 8, slug: "other-guide", title: "Other team guide", pageType: "service_guide" },
        { ...mappingTeam, id: 99, slug: "other-team", key: "other-team" },
      ),
      pageDetail(
        { id: 9, slug: "team-policy", title: "Team policy", pageType: "policy" },
        mappingTeam,
      ),
    ]);
    const html = await (await get("/services/mapping-team", content)).text();

    expect(html).toContain("Mapping quickstart");
    expect(html).not.toContain("Secret draft");
    expect(html).not.toContain("Other team guide");
    expect(html).not.toContain("Team policy");
  });

  it("leaves out the Guidance section when the team has no guides", async () => {
    const html = await (await get("/services/mapping-team", fakeContent([]))).text();

    expect(html).not.toMatch(/<h2[^>]*>Guidance<\/h2>/);
  });
});
