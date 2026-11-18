import { describe, expect, it } from "vitest";
import { migrationStatus, pageType } from "../../../src/db/schema/index.js";
import type { MigrationRecord, TargetEntity } from "../../../src/migration/records.js";
import { validateRecords } from "../../../src/migration/validate.js";
import { MIGRATION_STATUSES, PAGE_TYPES } from "../../../src/validation/catalogue.js";

function record(
  targetEntity: TargetEntity,
  key: string,
  fields: Record<string, unknown>,
  extra: Partial<MigrationRecord> = {},
): MigrationRecord {
  return {
    sourcePath: targetEntity === "page" ? `${key}.html` : "example.yml",
    sourceType: targetEntity === "page" ? "html" : "yaml",
    targetEntity,
    key,
    slug: key,
    fields,
    warnings: [],
    ...extra,
  };
}

const ownershipLevel = record("ownership_level", "undocumented", {
  key: "undocumented",
  name: "No central ownership",
  definition: null,
  description: null,
  targetState: null,
  weight: 1,
  hideInNavigation: false,
});

const tool = record("tool", "kettle-board", {
  key: "kettle-board",
  slug: "kettle-board",
  name: "Kettle Board",
  description: "A shared board.",
  engineeringOrBusinessTool: "business",
});

function instance(key: string, overrides: Record<string, unknown> = {}): MigrationRecord {
  return record("instance", key, {
    key,
    slug: key,
    name: "Kettle Board",
    toolKey: "kettle-board",
    isPlaceholder: true,
    url: "https://kettle.example.com",
    description: null,
    gettingAccess: "Ask for an invite.",
    management: null,
    authentication: null,
    userProvisioning: null,
    support: null,
    escalationContact: null,
    supportedByGdsSoftwareServiceDesk: false,
    notInUse: false,
    migrationStatus: "not_started",
    migrationDate: null,
    ownershipLevelKey: "undocumented",
    targetOwnershipLevelKey: null,
    contractKey: "kettle-board",
    extraAttributes: { used_by: "Example team" },
    lastReviewedAt: "2026-01-02",
    ...overrides,
  });
}

const contract = record("contract", "kettle-board", {
  toolKey: "kettle-board",
  startDate: "2025-04-01",
  endDate: "2027-03-31",
  cost: null,
  licenseTerms: null,
  costModel: null,
  commercials: "Annual licence",
  totalUsers: "120",
  operationalPolicy: null,
  dataProtectionAndSecurity: null,
});

const capability = record("capability", "note-taking", {
  key: "note-taking",
  name: "Note taking",
  description: null,
  groupName: "Collaboration",
  comment: null,
  weight: null,
  hideInNavigation: false,
  toolKeys: ["kettle-board"],
});

const team = record("product_team_service", "paper-planes", {
  key: "paper-planes",
  slug: "paper-planes",
  name: "Paper Planes Team",
  purpose: null,
  url: null,
  slackChannel: null,
  slackChannelName: null,
  teamEmailAddress: null,
  ghOrgs: ["example-org"],
  escalationContact: null,
  lastReviewedAt: null,
  weight: null,
  usesToolKeys: ["kettle-board"],
});

const businessUnit = record("business_unit", "skyward", {
  key: "skyward",
  name: "Skyward Directorate",
  level: "directorate",
  description: null,
  lead: null,
  url: null,
  escalationContact: null,
  weight: null,
  operatesKeys: ["paper-planes"],
  childKeys: [],
});

function unit(key: string, childKeys: string[]): MigrationRecord {
  return record("business_unit", key, { ...businessUnit.fields, key, operatesKeys: [], childKeys });
}

function page(slug: string, overrides: Record<string, unknown> = {}): MigrationRecord {
  return record(
    "page",
    slug,
    {
      slug,
      title: "Example page",
      pageType: "guidance",
      summary: null,
      ownerName: null,
      ownerContact: null,
      status: "published",
      lastReviewedAt: null,
      publishedAt: null,
      ...overrides,
    },
    { bodyMarkdown: "Example body.", builtPath: `${slug}.html` },
  );
}

const redirect = record(
  "redirect",
  "/tools/kettle-board/",
  { oldPath: "/tools/kettle-board/", newPath: "/tools/kettle-board" },
  { slug: "/tools/kettle-board/" },
);

const VALID: readonly MigrationRecord[] = [
  ownershipLevel,
  tool,
  instance("kettle-board"),
  contract,
  capability,
  team,
  businessUnit,
  page("widgets"),
  redirect,
];

describe("validating migration records", () => {
  it("accepts a consistent set of records", () => {
    expect(validateRecords(VALID)).toEqual([]);
  });

  it("refuses two records of the same type with the same key", () => {
    const issues = validateRecords([...VALID, { ...tool, sourcePath: "other.yml" }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      sourcePath: "other.yml",
      targetEntity: "tool",
      key: "kettle-board",
    });
  });

  it("refuses two pages with the same slug", () => {
    const duplicate = { ...page("widgets"), key: "widgets-again", sourcePath: "x.html" };
    const issues = validateRecords([...VALID, duplicate]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("slug");
  });

  it("refuses two redirects from the same old address", () => {
    const issues = validateRecords([...VALID, { ...redirect, sourcePath: "other.yml" }]);
    expect(issues).toHaveLength(1);
  });

  it("collects every missing reference, not just the first", () => {
    const issues = validateRecords([
      ownershipLevel,
      tool,
      instance("kettle-board", { toolKey: "missing-tool", ownershipLevelKey: "missing-level" }),
      { ...capability, fields: { ...capability.fields, toolKeys: ["missing-tool"] } },
      { ...team, fields: { ...team.fields, usesToolKeys: ["missing-tool"] } },
      { ...businessUnit, fields: { ...businessUnit.fields, operatesKeys: ["missing-team"] } },
    ]);
    expect(issues.map((issue) => [issue.targetEntity, issue.field])).toEqual([
      ["instance", "toolKey"],
      ["instance", "ownershipLevelKey"],
      ["instance", "contractKey"],
      ["capability", "toolKeys"],
      ["product_team_service", "usesToolKeys"],
      ["product_team_service", "key"],
      ["business_unit", "operatesKeys"],
    ]);
  });

  it("refuses a team that no business unit operates, as the current Hub does", () => {
    const issues = validateRecords(VALID.filter((r) => r !== businessUnit));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ targetEntity: "product_team_service", key: "paper-planes" });
  });

  it.each<[string, MigrationRecord]>([
    [
      "a key that isn't kebab case",
      { ...tool, key: "Kettle_Board", fields: { ...tool.fields, key: "Kettle_Board" } },
    ],
    ["a link that isn't http or https", instance("kettle-board", { url: "javascript:alert(1)" })],
    [
      "a date that isn't a calendar date",
      instance("kettle-board", { lastReviewedAt: "2026-02-30" }),
    ],
    ["an unknown migration status", instance("kettle-board", { migrationStatus: "nearly" })],
    [
      "an extra attribute that isn't text",
      instance("kettle-board", { extraAttributes: { count: 3 } }),
    ],
    ["a page title over 255 characters", page("widgets", { title: "x".repeat(256) })],
    ["an unknown page type", page("widgets", { pageType: "blog" })],
    [
      "a contract that ends before it starts",
      { ...contract, fields: { ...contract.fields, endDate: "2024-01-01" } },
    ],
    [
      "a redirect to another site",
      { ...redirect, fields: { ...redirect.fields, newPath: "//evil.example.com" } },
    ],
    [
      "a redirect from a full URL",
      { ...redirect, fields: { ...redirect.fields, oldPath: "https://evil.example.com/" } },
    ],
    [
      "a GitHub organisation name that isn't valid",
      { ...team, fields: { ...team.fields, ghOrgs: ["not valid"] } },
    ],
  ])("refuses %s", (_description, invalid) => {
    // Each type of record appears once in VALID, so swap in the invalid one.
    const records = [...VALID.filter((r) => r.targetEntity !== invalid.targetEntity), invalid];
    const issues = validateRecords(records);
    expect(issues.some((issue) => issue.targetEntity === invalid.targetEntity)).toBe(true);
  });

  it("never includes a field's value in an issue", () => {
    const issues = validateRecords([
      ...VALID.filter((r) => r.targetEntity !== "instance"),
      instance("kettle-board", { url: "not-a-url-PRIVATE-VALUE", lastReviewedAt: "PRIVATE-DATE" }),
    ]);
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain("PRIVATE");
  });
});

describe("business unit children", () => {
  it("are accepted when each unit has at most one parent", () => {
    expect(
      validateRecords([...VALID, unit("cloudward", ["starward"]), unit("starward", [])]),
    ).toEqual([]);
  });

  it("must exist", () => {
    const issues = validateRecords([...VALID, unit("cloudward", ["missing-unit"])]);
    expect(issues.map((issue) => [issue.key, issue.field])).toEqual([["cloudward", "childKeys"]]);
  });

  it("can't be listed by two units", () => {
    const issues = validateRecords([
      ...VALID,
      unit("cloudward", ["starward"]),
      unit("moonward", ["starward"]),
      unit("starward", []),
    ]);
    expect(issues.map((issue) => [issue.key, issue.field])).toEqual([["starward", "key"]]);
  });

  it("can't include the unit itself or lead back round to it", () => {
    const issues = validateRecords([
      ...VALID,
      unit("cloudward", ["cloudward"]),
      unit("moonward", ["starward"]),
      unit("starward", ["moonward"]),
    ]);
    expect(issues.map((issue) => issue.key).sort()).toEqual(["cloudward", "moonward", "starward"]);
  });
});

describe("shared validation", () => {
  it("knows the same page types as the database", () => {
    expect([...PAGE_TYPES]).toEqual(pageType.enumValues);
  });

  it("knows the same migration statuses as the database", () => {
    expect([...MIGRATION_STATUSES]).toEqual(migrationStatus.enumValues);
  });
});
