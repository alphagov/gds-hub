import { beforeAll, describe, expect, it } from "vitest";
import {
  buildMigrationPlan,
  type InventoryItem,
  type MigrationPlan,
} from "../../../src/migration/inventory.js";
import type { MigrationRecord } from "../../../src/migration/records.js";
import { createInventoryReport } from "../../../src/migration/report.js";
import { fixtureOptions, fixtureSources } from "./helpers.js";

// The build fixture holds 34 files: 32 pages, an image and a stylesheet.
// The data fixture holds 7 YAML files.
const BUILT_PAGES = 32;
const DATA_FILES = 7;

let plan: MigrationPlan;

beforeAll(async () => {
  plan = await buildMigrationPlan(fixtureSources(), fixtureOptions());
});

function item(path: string): InventoryItem {
  const found = plan.items.find((i) => i.path === path);
  if (found === undefined) throw new Error(`no inventory item for ${path}`);
  return found;
}

function records(entity: string): MigrationRecord[] {
  return plan.records.filter((r) => r.targetEntity === entity);
}

function record(entity: string, key: string): MigrationRecord {
  const found = records(entity).find((r) => r.key === key);
  if (found === undefined) throw new Error(`no ${entity} record ${key}`);
  return found;
}

function redirectTo(oldPath: string): string | undefined {
  const found = records("redirect").find((r) => r.fields.oldPath === oldPath);
  return found?.fields.newPath as string | undefined;
}

describe("the inventory of the fixture folders", () => {
  it("accounts for every built page and data file exactly once", () => {
    const paths = plan.items.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(plan.items.filter((i) => i.kind === "data_file")).toHaveLength(DATA_FILES);
    expect(plan.items.filter((i) => i.kind !== "data_file")).toHaveLength(BUILT_PAGES);
    for (const i of plan.items) {
      expect(["migrated", "skipped", "manual_review"]).toContain(i.status);
      expect(i.reason.length).toBeGreaterThan(0);
    }
  });

  it("finds no validation issues in the fixtures", () => {
    expect(plan.issues).toEqual([]);
  });

  it("makes the expected number of records of each type", () => {
    const counts = Object.fromEntries(
      [...new Set(plan.records.map((r) => r.targetEntity))].map((entity) => [
        entity,
        records(entity).length,
      ]),
    );
    expect(counts).toEqual({
      tool: 3,
      instance: 5,
      contract: 1,
      ownership_level: 2,
      capability: 2,
      product_team_service: 2,
      business_unit: 1,
      page: 8,
      redirect: 28,
    });
  });

  it("accounts for the data files, flagging one it doesn't know", () => {
    expect(item("tools.yml")).toMatchObject({ kind: "data_file", status: "migrated" });
    expect(item("retired_widgets.yml")).toMatchObject({
      kind: "data_file",
      status: "manual_review",
    });
  });
});

describe("pages rendered from YAML", () => {
  it("are matched to their YAML record, which redirects their old name-based address", () => {
    expect(item("tools/lantern-notes-wiki/index.html")).toMatchObject({
      kind: "record_page",
      status: "migrated",
      oldPath: "/tools/lantern-notes-wiki/",
      newPath: "/tools/lanternly",
      target: { entity: "tool", key: "lanternly" },
    });
    expect(redirectTo("/tools/lantern-notes-wiki/")).toBe("/tools/lanternly");
    expect(redirectTo("/instances/kettle-board-main.html")).toBe("/instances/kettle-board-main");
    expect(redirectTo("/capabilities/note-taking.html")).toBe("/capabilities/note-taking");
    expect(redirectTo("/products_teams_and_services/skyward-directorate/")).toBe(
      "/business-units/skyward-directorate",
    );
    expect(redirectTo("/products_teams_and_services/skyward-directorate/paper-planes-team/")).toBe(
      "/services/paper-planes",
    );
  });

  it("are never made into pages as well, so each thing is migrated once", () => {
    const fromYaml = plan.items
      .filter((i) => i.kind === "record_page" || i.kind === "listing_page")
      .map((i) => i.path);
    const pageSources = records("page").map((r) => r.builtPath);
    for (const path of fromYaml) {
      expect(pageSources).not.toContain(path);
    }
    expect(records("tool").map((r) => r.key)).toEqual(["kettle-board", "lanternly", "quillstack"]);
  });

  it("are recorded on their YAML record, which holds both halves", () => {
    expect(record("tool", "lanternly")).toMatchObject({
      sourcePath: "tools.yml",
      sourceType: "yaml",
      builtPath: "tools/lantern-notes-wiki/index.html",
    });
    expect(record("instance", "kettle-board-main").builtPath).toBe(
      "instances/kettle-board-main.html",
    );
    expect(record("product_team_service", "paper-planes").builtPath).toBe(
      "products_teams_and_services/skyward-directorate/paper-planes-team/index.html",
    );
    // A placeholder instance has no page of its own.
    expect(record("instance", "lanternly").builtPath).toBeUndefined();
  });

  it("are flagged for manual review when no record matches", () => {
    expect(item("tools/retired-gadget/index.html")).toMatchObject({
      kind: "record_page",
      status: "manual_review",
    });
    expect(redirectTo("/tools/retired-gadget/")).toBeUndefined();
  });

  it("include listings, which are skipped with a reason and redirect to their replacement", () => {
    expect(item("tools/index.html")).toMatchObject({
      kind: "listing_page",
      status: "skipped",
      newPath: "/tools",
    });
    expect(item("tools/collaboration-tools/index.html")).toMatchObject({
      kind: "listing_page",
      status: "skipped",
      newPath: "/tools",
    });
    expect(item("capabilities/collaboration-capability-group.html").newPath).toBe("/capabilities");
    expect(item("products_teams_and_services/index.html").newPath).toBe("/services");
    expect(item("search/index.html")).toMatchObject({ kind: "listing_page", status: "skipped" });
    expect(redirectTo("/tools/")).toBe("/tools");
    expect(redirectTo("/whats-new/")).toBe("/whats-new");
    expect(redirectTo("/")).toBeUndefined();
  });

  it("include a listing with no replacement yet, which is flagged for manual review", () => {
    expect(item("ownership/index.html")).toMatchObject({
      kind: "listing_page",
      status: "manual_review",
    });
  });
});

describe("content pages", () => {
  it("are converted from the built HTML alone", () => {
    expect(item("engineering/widgets/setup.html")).toMatchObject({
      kind: "content_page",
      status: "migrated",
      newPath: "/guidance/widgets-setup",
    });
    expect(record("page", "device-policy")).toMatchObject({
      sourcePath: "InfoSec/device-policy.html",
      sourceType: "html",
      builtPath: "InfoSec/device-policy.html",
      slug: "device-policy",
      fields: {
        slug: "device-policy",
        title: "Example device policy",
        pageType: "policy",
        summary: null,
        ownerName: null,
        ownerContact: null,
        status: "published",
        lastReviewedAt: null,
        publishedAt: null,
      },
    });
    expect(record("page", "device-policy").bodyMarkdown).toContain("## Scope");
    expect(record("page", "device-policy").bodyMarkdown).not.toContain("last reviewed");
  });

  it("include pages with no other source, such as an about page", () => {
    expect(item("about.html")).toMatchObject({ kind: "content_page", newPath: "/pages/about" });
  });

  it("are flagged for manual review when they have warnings that need a person", () => {
    expect(item("engineering/widgets/index.html").status).toBe("manual_review");
    expect(item("support.html").status).toBe("manual_review");
  });

  it("have their links to other migrated pages rewritten", () => {
    const widgets = record("page", "widgets").bodyMarkdown;
    expect(widgets).toContain("[widget set-up guide](/guidance/widgets-setup)");
    expect(widgets).toContain("[Lantern notes tool](/tools/lanternly)");
    expect(widgets).toContain("[device policy](/policies/device-policy#scope)");
    expect(record("page", "infosec").bodyMarkdown).toContain(
      "[Example device policy](/policies/device-policy)",
    );
    expect(record("page", "kettle-guide").bodyMarkdown).toContain(
      "[Kettle Board](/tools/kettle-board)",
    );
  });

  it("include blog posts, dated from their published line", () => {
    expect(record("page", "trying-out-paper-boats").fields).toMatchObject({
      pageType: "whats_new",
      publishedAt: "2026-03-04",
    });
    expect(record("page", "trying-out-paper-boats").bodyMarkdown).not.toContain("Published on");
  });
});

describe("other built files", () => {
  it("turn a redirect page into a redirect to where its target moved", () => {
    expect(item("old-widgets.html")).toMatchObject({ kind: "redirect_page", status: "migrated" });
    expect(redirectTo("/old-widgets.html")).toBe("/guidance/widgets");
  });

  it("flag a page with no content area and no redirect for manual review", () => {
    expect(item("widget-embed.html")).toMatchObject({
      kind: "unknown_page",
      status: "manual_review",
    });
  });

  it("list the images content pages use, and whether the build has them", () => {
    expect(plan.assets).toEqual([
      {
        path: "/images/widgets/diagram.svg",
        exists: true,
        referencedBy: ["engineering/widgets/index.html"],
      },
    ]);
  });
});

describe("the inventory report", () => {
  it("gives a pass or fail summary for each kind of input", () => {
    const report = createInventoryReport(plan, new Date("2026-11-11T12:00:00Z"));
    expect(report.passed).toBe(true);
    expect(report.summary.map((row) => [row.group, row.items, row.passed])).toEqual([
      ["content", 8, true],
      ["yaml", 18, true],
      ["listing", 11, true],
      ["redirect", 1, true],
      ["unknown", 1, true],
    ]);
    for (const row of report.summary) {
      expect(row.migrated + row.skipped + row.manualReview).toBe(row.items);
    }
  });

  it("holds paths, counts and warnings, never content", () => {
    const report = JSON.stringify(createInventoryReport(plan, new Date("2026-11-11T12:00:00Z")));
    for (const content of [
      "Widgets help teams build",
      "Ask in the example channel",
      "Request access through the example service desk",
      "This invented policy covers",
      "builds example paper planes",
      "Example Person",
    ]) {
      expect(report).not.toContain(content);
    }
    expect(report).toContain("engineering/widgets/index.html");
  });
});
