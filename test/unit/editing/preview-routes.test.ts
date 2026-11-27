import * as cheerio from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/app.js";
import type { EditorIdentityProvider } from "../../../src/editing/editor-identity.js";
import { createPreviewSigner } from "../../../src/editing/preview-signing.js";
import { createTestModeIdentity, TEST_MODE_WARNING } from "../../../src/editing/test-mode.js";
import { silentLogger } from "../../../src/lib/logger.js";
import { fakeCatalogue } from "../catalogue-fixtures.js";
import { fakeContent } from "../content-fixtures.js";
import { noRedirects, startApp, testConfig, type RunningApp } from "../helpers.js";
import { CHANGED_AT, fakeEditService, type FakeEditService } from "./edit-fixtures.js";

// Preview: the editor's values shown on the normal page, with nothing saved,
// and a signed payload that carries them to the save.

vi.setConfig({ testTimeout: 30_000 });

const SECRET = "route-test-secret-".padEnd(40, "x");
const TEST_MODE_ACTOR = "system:unauthenticated_test_mode";
const SAVE = "Save and publish";
const EDIT_AGAIN = "Continue editing";

let running: RunningApp | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

async function start(
  options: { identity?: EditorIdentityProvider; off?: boolean } = {},
): Promise<FakeEditService> {
  const service = fakeEditService();
  running = await startApp(
    createApp({
      config: testConfig,
      logger: silentLogger,
      catalogue: fakeCatalogue(),
      content: fakeContent(),
      redirects: noRedirects,
      ...(options.off
        ? {}
        : {
            editing: {
              identity: options.identity ?? createTestModeIdentity(),
              service,
              previewSigner: createPreviewSigner({ secret: SECRET }),
            },
          }),
    }),
  );
  return service;
}

async function post(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${running?.baseUrl ?? ""}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

const VENDOR_VALUES = {
  slug: "compass-co",
  name: "Compass Co Renamed",
  description: "Words typed but not yet saved.",
  url: "",
  updatedAt: CHANGED_AT.toISOString(),
};

/** The form on a preview page that has this button: where it posts, and the signed payload. */
function formWithButton(html: string, text: string): { action: string; preview: string } {
  const $ = cheerio.load(html);
  const button = $("button, input[type=submit]")
    .filter((_, element) => $(element).text().trim() === text || $(element).val() === text)
    .first();
  const form = button.closest("form");
  if (form.length === 0) throw new Error(`no form with a "${text}" button`);
  return {
    action: form.attr("action") ?? "",
    preview: form.find("input[name=preview]").attr("value") ?? "",
  };
}

async function previewOf(
  path: string,
  values: Record<string, string>,
): Promise<{ response: Response; html: string }> {
  const response = await post(path, values);
  return { response, html: await response.text() };
}

describe("previewing a change", () => {
  it("shows the normal page with the typed values and a not-saved banner", async () => {
    await start();

    const { response, html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const $ = cheerio.load(html);

    expect(response.status).toBe(200);
    expect($("h1").first().text()).toContain("Compass Co Renamed");
    expect(html).toContain("Words typed but not yet saved.");
    const banner = $(".govuk-notification-banner");
    expect(banner.text()).toMatch(/preview/i);
    expect(banner.text()).toMatch(/not saved/i);
    expect(html).toContain(TEST_MODE_WARNING);
  });

  it("writes nothing", async () => {
    const service = await start();

    await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    await previewOf("/edit/vendors/preview", { ...VENDOR_VALUES, slug: "new-co" });

    expect(service.writes).toEqual([]);
  });

  it("is never cached and never indexed", async () => {
    await start();

    const { response, html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(cheerio.load(html)('meta[name="robots"]').attr("content")).toMatch(/noindex/);
  });

  it("works for a record that has not been added yet", async () => {
    const service = await start();

    const { response, html } = await previewOf("/edit/vendors/preview", {
      slug: "brand-new-co",
      name: "Brand New Co",
      description: "",
      url: "",
    });

    expect(response.status).toBe(200);
    expect(cheerio.load(html)("h1").first().text()).toContain("Brand New Co");
    expect(service.writes).toEqual([]);
  });

  it("shows markdown as it will appear to readers, without anything unsafe", async () => {
    await start();

    const { response, html } = await previewOf("/edit/pages/5/preview", {
      title: "Device rules",
      pageType: "policy",
      summary: "What you can connect.",
      bodyMarkdown: "## Typed heading\n\nSome **bold** words.\n\n<script>alert(1)</script>",
      ownerName: "",
      ownerContact: "",
      productTeamServiceId: "",
      status: "published",
      lastReviewedAt: "",
      updatedAt: CHANGED_AT.toISOString(),
    });
    const $ = cheerio.load(html);

    expect(response.status).toBe(200);
    expect($("h2").text()).toContain("Typed heading");
    expect($("strong").text()).toContain("bold");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("shows the form again with what is wrong when the values are not valid", async () => {
    const service = await start();

    const { response, html } = await previewOf("/edit/vendors/3/preview", {
      ...VENDOR_VALUES,
      name: "",
      url: "javascript:alert(1)",
    });
    const $ = cheerio.load(html);

    expect(response.status).toBe(400);
    expect($(".govuk-error-summary").length).toBe(1);
    expect($(".govuk-notification-banner").text()).not.toMatch(/not saved/i);
    expect(service.writes).toEqual([]);
  });

  it("offers a way to save and a way to carry on editing, without JavaScript", async () => {
    await start();

    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);

    expect(formWithButton(html, SAVE).preview).not.toBe("");
    expect(formWithButton(html, EDIT_AGAIN).preview).not.toBe("");
  });

  it("does not change what readers see", async () => {
    await start();
    await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);

    const response = await fetch(`${running?.baseUrl ?? ""}/vendors/compass-co`);
    const html = await response.text();

    expect(html).not.toContain("Compass Co Renamed");
    expect(html).not.toMatch(/not saved/i);
    expect(response.headers.get("x-robots-tag")).toBeNull();
  });

  it("is not there when editing is switched off", async () => {
    await start({ off: true });

    expect((await post("/edit/vendors/3/preview", VENDOR_VALUES)).status).toBe(404);
  });

  it("is refused for a request from another site", async () => {
    const service = await start();

    const response = await post("/edit/vendors/3/preview", VENDOR_VALUES, {
      "sec-fetch-site": "cross-site",
    });

    expect(response.status).toBe(403);
    expect(service.writes).toEqual([]);
  });

  it("is refused for someone the identity provider doesn't recognise", async () => {
    const service = await start({ identity: { identify: () => Promise.resolve(undefined) } });

    const response = await post("/edit/vendors/3/preview", VENDOR_VALUES);

    expect(response.status).toBe(403);
    expect(service.writes).toEqual([]);
  });
});

describe("saving from a preview", () => {
  it("saves the previewed values once, as the editor, and goes to the saved page", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { action, preview } = formWithButton(html, SAVE);

    const response = await post(action, { preview });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^\/edit\/vendors\/3\?saved=updated$/);
    expect(service.writes).toHaveLength(1);
    expect(service.writes[0]).toMatchObject({
      operation: "update",
      entity: "vendors",
      id: 3,
      expectedUpdatedAt: CHANGED_AT,
      values: { name: "Compass Co Renamed", description: "Words typed but not yet saved." },
    });
    expect(service.writes[0]?.actor.email).toBe(TEST_MODE_ACTOR);
  });

  it("adds a new record from a preview", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/preview", {
      slug: "brand-new-co",
      name: "Brand New Co",
      description: "",
      url: "",
    });
    const { action, preview } = formWithButton(html, SAVE);

    const response = await post(action, { preview });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/saved=created/);
    expect(service.writes).toHaveLength(1);
    expect(service.writes[0]).toMatchObject({ operation: "create", entity: "vendors" });
  });

  it("refuses a payload whose values were changed, and writes nothing", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { action, preview } = formWithButton(html, SAVE);
    const [, signature] = preview.split(".");
    const forged = Buffer.from(
      JSON.stringify({ entity: "vendors", id: 3, values: { ...VENDOR_VALUES, name: "Evil Co" } }),
    ).toString("base64url");

    const response = await post(action, { preview: `${forged}.${signature}` });

    expect(response.status).toBe(400);
    expect(service.writes).toEqual([]);
  });

  it("refuses a payload with a changed signature, a missing payload and junk", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { action, preview } = formWithButton(html, SAVE);
    const corrupted = `${preview.slice(0, -4)}${preview.endsWith("AAAA") ? "BBBB" : "AAAA"}`;

    for (const body of [{ preview: corrupted }, {}, { preview: "" }, { preview: "junk" }]) {
      const response = await post(action, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(service.writes).toEqual([]);
  });

  it("refuses a payload made for another record, and writes nothing", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { preview } = formWithButton(html, SAVE);

    const otherRecord = await post("/edit/vendors/4/publish", { preview });
    const otherKind = await post("/edit/pages/5/publish", { preview });
    const asNew = await post("/edit/vendors/publish", { preview });

    expect([otherRecord.status, otherKind.status, asNew.status]).toEqual([400, 400, 400]);
    expect(service.writes).toEqual([]);
  });

  it("refuses a payload that has run out", async () => {
    const service = await start();
    const old = createPreviewSigner({
      secret: SECRET,
      now: () => new Date(Date.now() - 24 * 60 * 60_000),
    }).sign({
      entity: "vendors",
      id: 3,
      actor: TEST_MODE_ACTOR,
      loadedAt: CHANGED_AT.toISOString(),
      values: { slug: "compass-co", name: "Old Co", description: "", url: "" },
    });

    const response = await post("/edit/vendors/3/publish", { preview: old });

    expect(response.status).toBe(400);
    expect(service.writes).toEqual([]);
  });

  it("checks the values again, even in a correctly signed payload", async () => {
    const service = await start();
    const signed = createPreviewSigner({ secret: SECRET }).sign({
      entity: "vendors",
      id: 3,
      actor: TEST_MODE_ACTOR,
      loadedAt: CHANGED_AT.toISOString(),
      values: { slug: "compass-co", name: "", description: "", url: "javascript:alert(1)" },
    });

    const response = await post("/edit/vendors/3/publish", { preview: signed });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(service.writes).toEqual([]);
  });

  it("is refused for a request from another site", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { action, preview } = formWithButton(html, SAVE);

    const response = await post(action, { preview }, { "sec-fetch-site": "cross-site" });

    expect(response.status).toBe(403);
    expect(service.writes).toEqual([]);
  });
});

describe("continuing to edit from a preview", () => {
  it("shows the form again with the previewed values and writes nothing", async () => {
    const service = await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { action, preview } = formWithButton(html, EDIT_AGAIN);

    const response = await post(action, { preview });
    const $ = cheerio.load(await response.text());

    expect(response.status).toBe(200);
    expect($("input[name=name]").attr("value")).toBe("Compass Co Renamed");
    expect($("textarea[name=description]").text()).toContain("Words typed but not yet saved.");
    expect($("input[name=updatedAt]").attr("value")).toBe(CHANGED_AT.toISOString());
    expect(service.writes).toEqual([]);
  });

  it("refuses a payload that has been changed", async () => {
    await start();
    const { html } = await previewOf("/edit/vendors/3/preview", VENDOR_VALUES);
    const { action, preview } = formWithButton(html, EDIT_AGAIN);

    const response = await post(action, { preview: `${preview}x` });

    expect(response.status).toBe(400);
  });
});
