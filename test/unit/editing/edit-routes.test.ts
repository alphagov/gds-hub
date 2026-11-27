import * as cheerio from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDependencies } from "../../../src/app.js";
import { type EditorIdentityProvider } from "../../../src/editing/editor-identity.js";
import { createPreviewSigner } from "../../../src/editing/preview-signing.js";
import {
  createTestModeIdentity,
  TEST_MODE_ACTOR_EMAIL,
  TEST_MODE_WARNING,
} from "../../../src/editing/test-mode.js";
import { silentLogger } from "../../../src/lib/logger.js";
import type { RedirectService } from "../../../src/services/redirects/redirect-service.js";
import { systemActor } from "../../../src/services/audit/actor.js";
import { fakeCatalogue } from "../catalogue-fixtures.js";
import { fakeContent } from "../content-fixtures.js";
import { noRedirects, startApp, testConfig, type RunningApp } from "../helpers.js";
import {
  CHANGED_AT,
  fakeEditService,
  repositoryError,
  type FakeEditService,
} from "./edit-fixtures.js";

// Several tests start a new app for each request, and a new app compiles its
// templates again. That can take longer than the default 5 seconds when the
// whole suite runs at once.
vi.setConfig({ testTimeout: 30_000 });

let running: RunningApp | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

interface Setup {
  readonly service?: FakeEditService;
  readonly identity?: EditorIdentityProvider;
  /** Where old addresses go. Nothing redirects unless it is given. */
  readonly redirects?: RedirectService;
  /** Leave editing switched off. */
  readonly off?: boolean;
  /** Use the app the last call started, so a test can read its address first. */
  readonly reuse?: boolean;
}

let lastService: FakeEditService | undefined;

async function start({
  service = fakeEditService(),
  identity,
  redirects = noRedirects,
  off,
  reuse,
}: Setup = {}): Promise<FakeEditService> {
  if (reuse && running && lastService) return lastService;
  await running?.close();
  const editing: AppDependencies["editing"] = off
    ? undefined
    : {
        identity: identity ?? createTestModeIdentity(),
        service: service,
        previewSigner: createPreviewSigner({ secret: "edit-route-test-secret-".padEnd(40, "x") }),
      };
  running = await startApp(
    createApp({
      config: testConfig,
      logger: silentLogger,
      catalogue: fakeCatalogue(),
      content: fakeContent(),
      redirects,
      ...(editing === undefined ? {} : { editing }),
    }),
  );
  lastService = service;
  return service;
}

async function get(path: string, setup: Setup = {}): Promise<Response> {
  await start(setup);
  return fetch(`${running?.baseUrl ?? ""}${path}`, { redirect: "manual" });
}

async function post(
  path: string,
  body: Record<string, string>,
  { headers = {}, ...setup }: Setup & { headers?: Record<string, string> } = {},
): Promise<{ response: Response; service: FakeEditService }> {
  const service = await start(setup);
  const response = await fetch(`${running?.baseUrl ?? ""}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
  return { response, service };
}

function headingOf(html: string): string | undefined {
  const heading = cheerio.load(html)("h1").first();
  return heading.length === 0 ? undefined : heading.text().trim();
}

const VALID_VENDOR = { slug: "compass-co", name: "Compass Co", description: "", url: "" };

describe("when editing is switched off", () => {
  it.each(["/edit", "/edit/vendors", "/edit/vendors/new", "/edit/vendors/3"])(
    "gives page not found for GET %s",
    async (path) => {
      expect((await get(path, { off: true })).status).toBe(404);
    },
  );

  it("gives page not found for a POST, and writes nothing", async () => {
    const { response, service } = await post("/edit/vendors", VALID_VENDOR, { off: true });

    expect(response.status).toBe(404);
    expect(service.writes).toEqual([]);
  });
});

describe("test mode", () => {
  it("shows the not-signed-in warning on every edit page", async () => {
    const paths = [
      "/edit",
      "/edit/vendors",
      "/edit/vendors/new",
      "/edit/vendors/3",
      "/edit/vendors/3/delete",
      "/edit/pages/5",
    ];
    for (const path of paths) {
      const html = await (await get(path)).text();

      expect(html, path).toContain(TEST_MODE_WARNING);
    }
  });

  it("shows the warning on the pages that report a result", async () => {
    const saved = await (await get("/edit/vendors/3?saved=updated")).text();
    const invalid = await (await post("/edit/vendors", { slug: "BAD", name: "" })).response.text();
    const stale = await (
      await post(
        "/edit/vendors/3",
        { ...VALID_VENDOR, updatedAt: CHANGED_AT.toISOString() },
        { service: fakeEditService({ update: () => Promise.reject(repositoryError("stale")) }) },
      )
    ).response.text();
    const missing = await (await get("/edit/vendors/999")).text();

    for (const html of [saved, invalid, stale, missing]) expect(html).toContain(TEST_MODE_WARNING);
  });

  it("doesn't show the warning when the editor was verified, so a real provider removes it", async () => {
    const identity: EditorIdentityProvider = {
      identify: () => Promise.resolve({ actor: systemActor("data_migration"), verified: true }),
    };

    const html = await (await get("/edit", { identity })).text();

    expect(html).not.toContain(TEST_MODE_WARNING);
    expect(headingOf(html)).toBeDefined();
  });

  it("records whichever actor the provider gives, with the request's ID", async () => {
    const identity: EditorIdentityProvider = {
      identify: () => Promise.resolve({ actor: systemActor("data_migration"), verified: true }),
    };

    const { service } = await post("/edit/vendors", VALID_VENDOR, {
      identity,
      headers: { "x-request-id": "trace-me-1" },
    });

    expect(service.writes[0]?.actor).toEqual({
      email: "system:data_migration",
      requestId: "trace-me-1",
    });
  });

  it("refuses everything when the provider can't identify the editor", async () => {
    const identity: EditorIdentityProvider = { identify: () => Promise.resolve(undefined) };

    const read = await get("/edit/vendors", { identity });
    const { response, service } = await post("/edit/vendors", VALID_VENDOR, { identity });

    expect(read.status).toBe(403);
    expect(response.status).toBe(403);
    expect(service.writes).toEqual([]);
  });

  it("gives the 500 page when the provider fails", async () => {
    const identity: EditorIdentityProvider = { identify: () => Promise.reject(new Error("down")) };

    expect((await get("/edit", { identity })).status).toBe(500);
  });

  it("never writes on a GET", async () => {
    const service = fakeEditService();
    for (const path of [
      "/edit",
      "/edit/vendors",
      "/edit/vendors/new",
      "/edit/vendors/3",
      "/edit/vendors/3/delete",
    ]) {
      await get(path, { service });
    }

    expect(service.writes).toEqual([]);
  });

  it("is never cached, including redirects and errors", async () => {
    const responses = [
      await get("/edit"),
      await get("/edit/vendors/3"),
      await get("/edit/vendors/999"),
      (await post("/edit/vendors", VALID_VENDOR)).response,
      (await post("/edit/vendors", { slug: "BAD" })).response,
    ];

    for (const response of responses)
      expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("the edit pages", () => {
  it("lists what can be edited on the index", async () => {
    const html = await (await get("/edit")).text();

    for (const path of ["pages", "tools", "instances", "vendors", "services"]) {
      expect(html).toContain(`href="/edit/${path}"`);
    }
  });

  it("lists a kind of record with a link to each and to add one", async () => {
    const html = await (await get("/edit/vendors")).text();

    expect(html).toContain('href="/edit/vendors/3"');
    expect(html).toContain("Compass Co");
    expect(html).toContain('href="/edit/vendors/new"');
  });

  it("shows a result message after a save, and none otherwise", async () => {
    expect(await (await get("/edit/vendors/3?saved=updated")).text()).toMatch(/saved|updated/i);
    expect(await (await get("/edit/vendors?saved=deleted")).text()).toMatch(/deleted/i);
    expect(await (await get("/edit/vendors/3?saved=%3Cscript%3E")).text()).not.toContain(
      "<script>",
    );
  });

  it("shows a blank form for a new record, with labelled fields that post back", async () => {
    const html = await (await get("/edit/vendors/new")).text();

    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/edit\/vendors"/);
    expect(html).toMatch(/<label[^>]*for="slug"/);
    expect(html).toMatch(/<input[^>]*name="slug"/);
    expect(html).toMatch(/<input[^>]*name="name"/);
  });

  it("fills the form from the record, and sends back when it was last changed", async () => {
    const html = await (await get("/edit/vendors/3")).text();

    expect(html).toContain('value="Compass Co"');
    expect(html).toContain('value="https://compass.example.com"');
    expect(html).toMatch(
      new RegExp(
        `<input[^>]*type="hidden"[^>]*name="updatedAt"[^>]*value="${CHANGED_AT.toISOString()}"`,
      ),
    );
  });

  it("shows a slug as text on an existing record, not as something to change", async () => {
    const html = await (await get("/edit/vendors/3")).text();

    expect(html).toContain("compass-co");
    expect(html).not.toMatch(/<input[^>]*name="slug"/);
  });

  it("shows markdown in a textarea, a select for a type, and records to choose from", async () => {
    const html = await (await get("/edit/pages/5")).text();

    expect(html).toMatch(/<textarea[^>]*name="bodyMarkdown"/);
    expect(html).toContain("## Scope");
    expect(html).toMatch(/<select[^>]*name="pageType"/);
    expect(html).toMatch(/<option[^>]*value="policy"[^>]*selected/);
    expect(html).toMatch(/<select[^>]*name="productTeamServiceId"/);
    expect(html).toContain("Mapping Team");
  });

  it("escapes what it shows", async () => {
    const service = fakeEditService({
      find: () =>
        Promise.resolve({
          id: 3,
          title: "<img src=x onerror=alert(1)>",
          updatedAt: CHANGED_AT,
          values: {
            slug: "a",
            name: '"><script>alert(1)</script>',
            description: "</textarea><b>x</b>",
          },
        }),
    });

    const html = await (await get("/edit/vendors/3", { service })).text();

    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("</textarea><b>");
  });

  it.each([
    ["an unknown kind of record", "/edit/widgets"],
    ["an unknown kind with an id", "/edit/widgets/3"],
    ["a record that isn't there", "/edit/vendors/999"],
    ["an id that isn't a number", "/edit/vendors/abc"],
    ["a negative id", "/edit/vendors/-1"],
    ["an id too large for the database", "/edit/vendors/99999999999999999999"],
    ["an id with extra characters", "/edit/vendors/3x"],
    ["the delete page of a record that isn't there", "/edit/vendors/999/delete"],
  ])("gives page not found for %s", async (_name, path) => {
    expect((await get(path)).status).toBe(404);
  });
});

describe("saving a new record", () => {
  it("writes it as the test mode actor, then redirects to the saved record", async () => {
    const { response, service } = await post("/edit/vendors", VALID_VENDOR);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/edit/vendors/9?saved=created");
    expect(service.writes).toHaveLength(1);
    expect(service.writes[0]).toMatchObject({
      operation: "create",
      entity: "vendors",
      values: { slug: "compass-co", name: "Compass Co", description: null, url: null },
      actor: { email: TEST_MODE_ACTOR_EMAIL },
    });
  });

  it("shows what is wrong, keeps what was typed and writes nothing", async () => {
    const { response, service } = await post("/edit/vendors", {
      slug: "Not A Slug",
      name: "",
      url: "javascript:alert(1)",
      description: "Typed text to keep",
    });
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(service.writes).toEqual([]);
    expect(html).toContain("There is a problem");
    expect(html).toMatch(/<a[^>]*href="#slug"/);
    expect(html).toMatch(/<a[^>]*href="#name"/);
    expect(html).toContain("govuk-error-message");
    expect(html).toContain("Typed text to keep");
    expect(html).toContain('value="Not A Slug"');
    expect(html).not.toContain("<title>Add a vendor");
    expect(html).toMatch(/<title>Error: /);
  });

  it("says when another record already has the value", async () => {
    const service = fakeEditService({ create: () => Promise.reject(repositoryError("duplicate")) });

    const { response } = await post("/edit/vendors", VALID_VENDOR, { service });
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("There is a problem");
    expect(html).toMatch(/already (in use|exists)|another .* already/i);
    expect(html).toContain('value="compass-co"');
  });

  it("gives the 500 page for a database failure, without the values", async () => {
    const service = fakeEditService({ create: () => Promise.reject(repositoryError("failed")) });

    const { response } = await post(
      "/edit/vendors",
      { ...VALID_VENDOR, description: "private words" },
      { service },
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).not.toContain("private words");
  });

  it("refuses a body that isn't form data", async () => {
    await start();
    const response = await fetch(`${running?.baseUrl ?? ""}/edit/vendors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID_VENDOR),
    });

    expect(response.status).toBe(400);
  });
});

describe("saving changes", () => {
  const UPDATE = {
    name: "Compass Co (new)",
    description: "",
    url: "",
    updatedAt: CHANGED_AT.toISOString(),
  };

  it("writes the changes, saying what it saw when it was loaded, then redirects", async () => {
    const { response, service } = await post("/edit/vendors/3", UPDATE);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/edit/vendors/3?saved=updated");
    expect(service.writes[0]).toMatchObject({
      operation: "update",
      entity: "vendors",
      id: 3,
      values: { name: "Compass Co (new)" },
      actor: { email: TEST_MODE_ACTOR_EMAIL },
    });
    expect(service.writes[0]?.expectedUpdatedAt?.toISOString()).toBe(CHANGED_AT.toISOString());
  });

  it("refuses a form that doesn't say when the record was loaded", async () => {
    for (const updatedAt of [undefined, "", "yesterday"]) {
      const body: Record<string, string> = { name: "x" };
      if (updatedAt !== undefined) body.updatedAt = updatedAt;

      const { response, service } = await post("/edit/vendors/3", body);

      expect(response.status, String(updatedAt)).toBe(400);
      expect(service.writes).toEqual([]);
    }
  });

  it("tells the editor someone else changed the record, and keeps what they typed", async () => {
    const service = fakeEditService({ update: () => Promise.reject(repositoryError("stale")) });

    const { response } = await post(
      "/edit/vendors/3",
      { ...UPDATE, description: "My careful words" },
      { service },
    );
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(html).toMatch(/changed (by someone else|since)/i);
    expect(html).toContain("My careful words");
    expect(html).toMatch(/href="\/edit\/vendors\/3"/);
  });

  it("gives page not found if the record has gone", async () => {
    const service = fakeEditService({ update: () => Promise.reject(repositoryError("not_found")) });

    expect((await post("/edit/vendors/3", UPDATE, { service })).response.status).toBe(404);
  });

  it("shows validation errors without writing", async () => {
    const { response, service } = await post("/edit/vendors/3", { ...UPDATE, name: "" });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("There is a problem");
    expect(service.writes).toEqual([]);
  });
});

describe("adding a page", () => {
  it("starts with draft chosen as the status", async () => {
    const $ = cheerio.load(await (await get("/edit/pages/new")).text());

    expect($("select[name=status] option[selected]").attr("value")).toBe("draft");
    expect($("select[name=status] option[value='']").length).toBe(0);
  });
});

describe("deleting", () => {
  it("asks for confirmation first, naming the record, and says it can't be undone from the page", async () => {
    const html = await (await get("/edit/vendors/3/delete")).text();

    expect(html).toContain("Compass Co");
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/edit\/vendors\/3\/delete"/);
    expect(html).toMatch(/delete/i);
    expect(html).toMatch(/href="\/edit\/vendors\/3"/);
  });

  it("deletes on a POST, then redirects to the list", async () => {
    const { response, service } = await post("/edit/vendors/3/delete", {
      updatedAt: CHANGED_AT.toISOString(),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/edit/vendors?saved=deleted");
    expect(service.writes[0]).toMatchObject({
      operation: "remove",
      entity: "vendors",
      id: 3,
      actor: { email: TEST_MODE_ACTOR_EMAIL },
    });
    expect(service.writes[0]?.expectedUpdatedAt?.toISOString()).toBe(CHANGED_AT.toISOString());
  });

  it("sends the version the editor is confirming back with the confirmation", async () => {
    const html = await (await get("/edit/vendors/3/delete")).text();

    expect(html).toMatch(/<input[^>]*name="updatedAt"[^>]*value="[^"]+"/);
  });

  it("refuses a confirmation that doesn't say which version it is for", async () => {
    const { response, service } = await post("/edit/vendors/3/delete", {});

    expect(response.status).toBe(400);
    expect(service.writes).toEqual([]);
  });

  it("says when the record changed since the confirmation was opened, and leaves it", async () => {
    const service = fakeEditService({ remove: () => Promise.reject(repositoryError("stale")) });

    const { response } = await post(
      "/edit/vendors/3/delete",
      { updatedAt: CHANGED_AT.toISOString() },
      { service },
    );
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(html).toMatch(/changed by someone else/i);
    expect(html).toContain(TEST_MODE_WARNING);
  });

  it("says when something still uses the record, and leaves it", async () => {
    const service = fakeEditService({ remove: () => Promise.reject(repositoryError("in_use")) });

    const { response } = await post(
      "/edit/vendors/3/delete",
      { updatedAt: CHANGED_AT.toISOString() },
      { service },
    );
    const html = await response.text();

    expect(response.status).toBe(409);
    expect(html).toMatch(/still (used|in use)|can.t be deleted/i);
    expect(html).toContain(TEST_MODE_WARNING);
  });
});

describe("requests from other sites", () => {
  const CROSS_SITE = [
    ["Sec-Fetch-Site says cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site says same-site", { "sec-fetch-site": "same-site" }],
    ["the Origin is another site", { origin: "https://evil.example" }],
    ["the Origin is null", { origin: "null" }],
  ] as const;

  it.each(CROSS_SITE)("are refused and write nothing when %s", async (_name, headers) => {
    for (const [path, body] of [
      ["/edit/vendors", VALID_VENDOR],
      ["/edit/vendors/3", { name: "x", updatedAt: CHANGED_AT.toISOString() }],
      ["/edit/vendors/3/delete", { updatedAt: CHANGED_AT.toISOString() }],
    ] as const) {
      const { response, service } = await post(path, { ...body }, { headers });

      expect(response.status, path).toBe(403);
      expect(service.writes, path).toEqual([]);
    }
  });

  it("are allowed from the same origin, and from tools that send neither header", async () => {
    await start();
    const host = new URL(running?.baseUrl ?? "").host;
    for (const headers of [{ "sec-fetch-site": "same-origin" }, { origin: `http://${host}` }, {}]) {
      const { response } = await post("/edit/vendors", VALID_VENDOR, { headers, reuse: true });

      expect(response.status, JSON.stringify(headers)).toBe(303);
    }
  });
});

describe("the Origin of a write when Sec-Fetch-Site is missing", () => {
  it("must match the scheme as well as the host", async () => {
    await start();
    const host = new URL(running?.baseUrl ?? "").host;

    const { response, service } = await post("/edit/vendors", VALID_VENDOR, {
      headers: { origin: `https://${host}` },
      reuse: true,
    });

    expect(response.status).toBe(403);
    expect(service.writes).toEqual([]);
  });

  it("matches https when the load balancer says the browser used it", async () => {
    await start();
    const host = new URL(running?.baseUrl ?? "").host;

    const { response } = await post("/edit/vendors", VALID_VENDOR, {
      headers: { origin: `https://${host}`, "x-forwarded-proto": "https" },
      reuse: true,
    });

    expect(response.status).toBe(303);
  });

  it("is refused if the browser used https but the Origin says http", async () => {
    await start();
    const host = new URL(running?.baseUrl ?? "").host;

    const { response } = await post("/edit/vendors", VALID_VENDOR, {
      headers: { origin: `http://${host}`, "x-forwarded-proto": "https" },
      reuse: true,
    });

    expect(response.status).toBe(403);
  });
});

describe("an editing address that isn't found", () => {
  it("is never redirected, even if an old address matches, so it can't be cached", async () => {
    const redirects: RedirectService = { newPathFor: () => Promise.resolve("/tools") };

    const response = await get("/edit/vendors/999", { redirects });

    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("still lets other addresses redirect", async () => {
    const redirects: RedirectService = { newPathFor: () => Promise.resolve("/tools") };

    const response = await get("/editorial-policy.html", { redirects });

    expect(response.status).toBe(301);
  });
});

describe("addresses outside /edit", () => {
  it("are not checked for an editor, so a provider that refuses doesn't affect readers", async () => {
    const identity: EditorIdentityProvider = { identify: () => Promise.resolve(undefined) };

    const missing = await get("/no-such-page", { identity });
    const read = await get("/tools", { identity });

    expect(missing.status).toBe(404);
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).not.toBe("no-store");
  });
});
