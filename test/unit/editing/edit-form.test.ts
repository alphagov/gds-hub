import { describe, expect, it } from "vitest";
import { EDIT_ENTITIES, EDIT_ENTITY_KEYS } from "../../../src/editing/entities.js";
import { parseForm } from "../../../src/editing/form.js";

// The forms' own rules: what a submitted body becomes, and what is refused
// before the database sees it. Values are invented.

const vendors = EDIT_ENTITIES.vendors;
const pages = EDIT_ENTITIES.pages;
const instances = EDIT_ENTITIES.instances;
const services = EDIT_ENTITIES.services;
const tools = EDIT_ENTITIES.tools;

function valuesOf(result: ReturnType<typeof parseForm>): Record<string, unknown> {
  if (!result.ok) throw new Error(`expected valid values, got ${JSON.stringify(result.errors)}`);
  return result.values;
}

function errorsOf(result: ReturnType<typeof parseForm>): Record<string, string> {
  if (result.ok) throw new Error("expected errors");
  return Object.fromEntries(result.errors.map((error) => [error.field, error.message]));
}

describe("the editable entities", () => {
  it("are pages, tools, instances, vendors and services", () => {
    expect([...EDIT_ENTITY_KEYS].sort()).toEqual([
      "instances",
      "pages",
      "services",
      "tools",
      "vendors",
    ]);
  });

  it("each have a label for people and fields with labels", () => {
    for (const key of EDIT_ENTITY_KEYS) {
      const entity = EDIT_ENTITIES[key];
      expect(entity.singular).not.toBe("");
      expect(entity.plural).not.toBe("");
      expect(entity.fields.length).toBeGreaterThan(0);
      for (const field of entity.fields) expect(field.label).not.toBe("");
    }
  });
});

describe("parseForm", () => {
  it("turns blank optional text into null and trims text", () => {
    const values = valuesOf(
      parseForm(
        vendors,
        { slug: " compass-co ", name: "  Compass Co ", description: "   ", url: "" },
        "create",
      ),
    );

    expect(values).toMatchObject({
      slug: "compass-co",
      name: "Compass Co",
      description: null,
      url: null,
    });
  });

  it("refuses a missing required value, naming the field", () => {
    expect(errorsOf(parseForm(vendors, { slug: "compass-co", name: "  " }, "create"))).toEqual({
      name: expect.stringMatching(/enter/i) as string,
    });
  });

  it("refuses a slug that isn't lower-case words with hyphens", () => {
    expect(
      errorsOf(parseForm(vendors, { slug: "Compass_Co", name: "x" }, "create")),
    ).toHaveProperty("slug");
  });

  it("refuses a web address that isn't http or https", () => {
    for (const url of [
      "javascript:alert(1)",
      "ftp://example.com",
      "example.com",
      "https://a b.example",
    ]) {
      expect(
        errorsOf(parseForm(vendors, { slug: "a", name: "x", url }, "create")),
        url,
      ).toHaveProperty("url");
    }
  });

  it("collects every problem, not only the first", () => {
    const errors = errorsOf(parseForm(vendors, { slug: "BAD", name: "", url: "nope" }, "create"));

    expect(Object.keys(errors).sort()).toEqual(["name", "slug", "url"]);
  });

  it("gives the submitted text back with the errors so the form can show it", () => {
    const result = parseForm(vendors, { slug: "BAD", name: "Keep me" }, "create");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.submitted).toMatchObject({ slug: "BAD", name: "Keep me" });
  });

  it("ignores fields the form doesn't have, so a body can't write other columns", () => {
    const values = valuesOf(
      parseForm(
        vendors,
        { slug: "a", name: "x", id: "99", createdAt: "2020-01-01", unknown: "y" },
        "create",
      ),
    );

    expect(Object.keys(values).sort()).toEqual([
      "dataProtectionContact",
      "description",
      "name",
      "slug",
      "supportContact",
      "url",
    ]);
  });

  it("ignores a value sent more than once", () => {
    const result = parseForm(vendors, { slug: ["a", "b"], name: "x" }, "create");

    expect(errorsOf(result)).toHaveProperty("slug");
  });

  it("doesn't let an update change a slug, because that would break its address", () => {
    const values = valuesOf(parseForm(vendors, { slug: "other-slug", name: "New name" }, "update"));

    expect(values).not.toHaveProperty("slug");
    expect(values).toMatchObject({ name: "New name" });
  });

  it("checks a select against its choices", () => {
    const base = { slug: "a", title: "T", bodyMarkdown: "Body", status: "published" };

    expect(valuesOf(parseForm(pages, { ...base, pageType: "policy" }, "create"))).toMatchObject({
      pageType: "policy",
    });
    expect(errorsOf(parseForm(pages, { ...base, pageType: "other" }, "create"))).toHaveProperty(
      "pageType",
    );
    expect(
      errorsOf(parseForm(pages, { ...base, pageType: "policy", status: "archived" }, "create")),
    ).toHaveProperty("status");
  });

  it("only lets a page be published if readers have a page for its type", () => {
    const base = { slug: "a", title: "T", bodyMarkdown: "Body" };

    for (const pageType of ["policy", "guidance", "service_guide"]) {
      const result = parseForm(pages, { ...base, pageType, status: "published" }, "create");
      expect(result.ok, pageType).toBe(true);
    }
    for (const pageType of ["general", "whats_new"]) {
      const published = parseForm(pages, { ...base, pageType, status: "published" }, "create");
      expect(errorsOf(published), pageType).toHaveProperty("status");
      const draft = parseForm(pages, { ...base, pageType, status: "draft" }, "create");
      expect(draft.ok, pageType).toBe(true);
    }
  });

  it("keeps markdown as typed, with its line breaks and no trimming of inner space", () => {
    const body = "## Scope\r\n\r\n- one\r\n- two  \r\n";
    const values = valuesOf(
      parseForm(
        pages,
        { slug: "a", title: "T", pageType: "policy", status: "draft", bodyMarkdown: body },
        "create",
      ),
    );

    expect(values.bodyMarkdown).toBe("## Scope\n\n- one\n- two  \n");
  });

  it("refuses an empty page body", () => {
    const body = {
      slug: "a",
      title: "T",
      pageType: "policy",
      status: "draft",
      bodyMarkdown: "  \n ",
    };

    expect(errorsOf(parseForm(pages, body, "create"))).toHaveProperty("bodyMarkdown");
  });

  it("reads dates, and refuses one that isn't a real calendar date", () => {
    const base = { slug: "a", title: "T", pageType: "policy", status: "draft", bodyMarkdown: "B" };

    expect(
      valuesOf(parseForm(pages, { ...base, lastReviewedAt: "2026-07-15" }, "create")),
    ).toMatchObject({
      lastReviewedAt: "2026-07-15",
    });
    expect(valuesOf(parseForm(pages, { ...base, lastReviewedAt: "" }, "create"))).toMatchObject({
      lastReviewedAt: null,
    });
    expect(
      errorsOf(parseForm(pages, { ...base, lastReviewedAt: "2026-02-30" }, "create")),
    ).toHaveProperty("lastReviewedAt");
    expect(
      errorsOf(parseForm(pages, { ...base, lastReviewedAt: "15/07/2026" }, "create")),
    ).toHaveProperty("lastReviewedAt");
  });

  it("turns a chosen record into its id, and no choice into null", () => {
    const base = { slug: "a", title: "T", pageType: "policy", status: "draft", bodyMarkdown: "B" };

    expect(
      valuesOf(parseForm(pages, { ...base, productTeamServiceId: "12" }, "create")),
    ).toMatchObject({
      productTeamServiceId: 12,
    });
    expect(
      valuesOf(parseForm(pages, { ...base, productTeamServiceId: "" }, "create")),
    ).toMatchObject({
      productTeamServiceId: null,
    });
    expect(
      errorsOf(parseForm(pages, { ...base, productTeamServiceId: "abc" }, "create")),
    ).toHaveProperty("productTeamServiceId");
  });

  it("requires a tool for an instance", () => {
    const body = { slug: "a", name: "N", migrationStatus: "not_started" };

    expect(errorsOf(parseForm(instances, body, "create"))).toHaveProperty("toolId");
    expect(valuesOf(parseForm(instances, { ...body, toolId: "2" }, "create"))).toMatchObject({
      toolId: 2,
    });
  });

  it("reads checkboxes as true when ticked and false when absent", () => {
    const base = { slug: "a", name: "N", toolId: "2", migrationStatus: "not_started" };

    expect(valuesOf(parseForm(instances, { ...base, notInUse: "true" }, "create"))).toMatchObject({
      notInUse: true,
      isPlaceholder: false,
    });
  });

  it("sets an instance's key and a tool's key from the slug when it is created", () => {
    expect(
      valuesOf(parseForm(tools, { slug: "atlas-maker", name: "Atlas Maker" }, "create")),
    ).toMatchObject({
      key: "atlas-maker",
      slug: "atlas-maker",
    });
    expect(
      valuesOf(parseForm(tools, { slug: "atlas-maker", name: "Atlas Maker" }, "update")),
    ).not.toHaveProperty("key");
  });

  it("reads one GitHub organisation per line, and refuses a name GitHub wouldn't allow", () => {
    const base = { slug: "a", name: "Team" };

    expect(
      valuesOf(parseForm(services, { ...base, ghOrgs: "alphagov\r\n\r\n  gds-team \n" }, "create")),
    ).toMatchObject({
      ghOrgs: ["alphagov", "gds-team"],
    });
    expect(
      errorsOf(parseForm(services, { ...base, ghOrgs: "alphagov\nnot valid!" }, "create")),
    ).toHaveProperty("ghOrgs");
    expect(valuesOf(parseForm(services, { ...base, ghOrgs: "" }, "create"))).toMatchObject({
      ghOrgs: [],
    });
  });

  it("reads a whole-number weight, and refuses anything else", () => {
    const base = { slug: "a", name: "Team" };

    expect(valuesOf(parseForm(services, { ...base, weight: "10" }, "create"))).toMatchObject({
      weight: 10,
    });
    expect(valuesOf(parseForm(services, { ...base, weight: "" }, "create"))).toMatchObject({
      weight: null,
    });
    for (const weight of ["1.5", "ten", "1e3", "99999999999"]) {
      expect(errorsOf(parseForm(services, { ...base, weight }, "create")), weight).toHaveProperty(
        "weight",
      );
    }
  });

  it("never puts the text it was given into an error message", () => {
    const secret = "very-private-text";
    const errors = errorsOf(
      parseForm(vendors, { slug: secret.toUpperCase(), name: "x", url: secret }, "create"),
    );

    expect(JSON.stringify(errors).toLowerCase()).not.toContain(secret);
  });
});
