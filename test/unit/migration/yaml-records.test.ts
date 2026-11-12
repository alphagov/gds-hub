import { describe, expect, it } from "vitest";
import type { MigrationRecord } from "../../../src/migration/records.js";
import { recordsFromYaml, type DataFile } from "../../../src/migration/yaml-records.js";

function file(name: string, text: string): DataFile {
  return { sourcePath: name, text };
}

const TOOLS = file(
  "tools.yml",
  `
kettle-board:
  name: Kettle Board
  url: https://kettle.example.com
  engineering_or_business_tool: Business Tool
  description: |
    A shared board for planning example work.
  getting_access: |
    Ask in the example channel for an invite.
  supported_by_gds_software_service_desk: true
  ownership_level: team_owned
  target_ownership_level: team-owned
  identity_migration_status: Migration to DSIT complete
  migration_date: 14/02/2026
  not_in_use: false
  support: Ask the example support team.
  cost_model: Per seat
  commercials: Annual licence
  operational_policy: Follow the example policy.
  data_protection_and_security: Example assessment done.
  license_start_date: 01/04/2025
  license_end_date: ongoing
  total_users: 120
  last_updated: 02/01/2026
  weight: 3
  group: Planning
quillstack:
  name: Quillstack
  engineering_or_business_tool: Engineering Tool
  description: Builds example pipelines.
  identity_migration_status: Waiting for the example supplier
  not_in_use: true
  favourite_colour: teal
`,
);

function find(records: readonly MigrationRecord[], entity: string, key: string): MigrationRecord {
  const record = records.find((r) => r.targetEntity === entity && r.key === key);
  if (record === undefined) throw new Error(`no ${entity} record ${key}`);
  return record;
}

function codes(record: MigrationRecord): string[] {
  return record.warnings.map((warning) => warning.code);
}

describe("tools", () => {
  const { records, issues } = recordsFromYaml([TOOLS]);

  it("are read without issues", () => {
    expect(issues).toEqual([]);
  });

  it("become tool records keyed and slugged by their YAML key", () => {
    expect(find(records, "tool", "kettle-board")).toEqual({
      sourcePath: "tools.yml",
      sourceType: "yaml",
      targetEntity: "tool",
      key: "kettle-board",
      slug: "kettle-board",
      fields: {
        key: "kettle-board",
        slug: "kettle-board",
        name: "Kettle Board",
        description: "A shared board for planning example work.",
        engineeringOrBusinessTool: "business",
      },
      warnings: expect.any(Array),
    });
    expect(find(records, "tool", "quillstack").fields.engineeringOrBusinessTool).toBe(
      "engineering",
    );
  });

  it("put the tool's own settings on a placeholder instance", () => {
    expect(find(records, "instance", "kettle-board").fields).toEqual({
      key: "kettle-board",
      slug: "kettle-board",
      name: "Kettle Board",
      toolKey: "kettle-board",
      isPlaceholder: true,
      url: "https://kettle.example.com",
      description: null,
      gettingAccess: "Ask in the example channel for an invite.",
      management: null,
      authentication: null,
      userProvisioning: null,
      support: "Ask the example support team.",
      escalationContact: null,
      supportedByGdsSoftwareServiceDesk: true,
      notInUse: false,
      migrationStatus: "complete",
      migrationDate: "2026-02-14",
      ownershipLevelKey: "team-owned",
      targetOwnershipLevelKey: "team-owned",
      contractKey: "kettle-board",
      extraAttributes: {},
      lastReviewedAt: "2026-01-02",
    });
  });

  it("put commercial fields on a contract for the tool", () => {
    expect(find(records, "contract", "kettle-board").fields).toEqual({
      toolKey: "kettle-board",
      startDate: "2025-04-01",
      endDate: null,
      cost: null,
      licenseTerms: null,
      costModel: "Per seat",
      commercials: "Annual licence",
      totalUsers: "120",
      operationalPolicy: "Follow the example policy.",
      dataProtectionAndSecurity: "Example assessment done.",
    });
  });

  it("have no contract when they have no commercial fields", () => {
    expect(records.some((r) => r.targetEntity === "contract" && r.key === "quillstack")).toBe(
      false,
    );
    expect(find(records, "instance", "quillstack").fields.contractKey).toBeNull();
  });

  it("fall back to the undocumented ownership level, as the current Hub does", () => {
    const placeholder = find(records, "instance", "quillstack");
    expect(placeholder.fields.ownershipLevelKey).toBe("undocumented");
    expect(placeholder.fields.targetOwnershipLevelKey).toBe("undocumented");
    expect(placeholder.warnings).toContainEqual(
      expect.objectContaining({ code: "defaulted_value", manualReview: false }),
    );
  });

  it("keep a migration status that can't be mapped, and flag it for manual review", () => {
    const placeholder = find(records, "instance", "quillstack");
    expect(placeholder.fields.migrationStatus).toBe("in_progress");
    expect(placeholder.fields.extraAttributes).toEqual({
      identity_migration_status: "Waiting for the example supplier",
    });
    expect(placeholder.warnings).toContainEqual(
      expect.objectContaining({ code: "unmapped_value", manualReview: true }),
    );
  });

  it("flag fields the migration doesn't know for manual review, without their values", () => {
    const tool = find(records, "tool", "quillstack");
    expect(codes(tool)).toContain("unknown_field");
    expect(tool.warnings.find((w) => w.code === "unknown_field")?.message).toContain(
      "favourite_colour",
    );
    expect(JSON.stringify(records.flatMap((r) => r.warnings))).not.toContain("teal");
  });

  it("leave out fields that only set the old site's navigation", () => {
    const all = JSON.stringify(records.map((r) => r.fields));
    expect(all).not.toContain("Planning");
    expect(codes(find(records, "tool", "kettle-board"))).toEqual(
      expect.arrayContaining(["ignored_field"]),
    );
  });

  it("use a different placeholder key when an instance already has the tool's key", () => {
    const result = recordsFromYaml([
      TOOLS,
      file("instances.yml", "quillstack:\n  tool: quillstack\n  name: Quillstack workspace\n"),
    ]);
    expect(find(result.records, "instance", "quillstack").fields.isPlaceholder).toBe(false);
    expect(find(result.records, "instance", "quillstack-tool").fields).toMatchObject({
      isPlaceholder: true,
      toolKey: "quillstack",
    });
  });
});

describe("instances", () => {
  const { records, issues } = recordsFromYaml([
    TOOLS,
    file(
      "instances.yml",
      `
kettle-board-main:
  tool: kettle-board
  name: Kettle Board main workspace
  url: https://main.kettle.example.com
  getting_access: |
    Request access through the example service desk.
  authentication: Sign in with the example identity provider
  user_provisioning: Automatic
  last_updated: 02/07/2026
  account_identifier: 123456
  used_by: Example team
  regions:
    - north
    - south
  weight: 2
lantern-space:
  tool: kettle
  url: not a web address
  last_updated: sometime soon
`,
    ),
  ]);

  it("map known fields to columns and keep the rest as extra attributes", () => {
    expect(find(records, "instance", "kettle-board-main").fields).toMatchObject({
      key: "kettle-board-main",
      slug: "kettle-board-main",
      name: "Kettle Board main workspace",
      toolKey: "kettle-board",
      isPlaceholder: false,
      url: "https://main.kettle.example.com",
      gettingAccess: "Request access through the example service desk.",
      authentication: "Sign in with the example identity provider",
      userProvisioning: "Automatic",
      migrationStatus: "not_started",
      ownershipLevelKey: null,
      lastReviewedAt: "2026-07-02",
      extraAttributes: {
        account_identifier: "123456",
        used_by: "Example team",
        regions: "north, south",
      },
    });
    expect(issues).toEqual([]);
  });

  it("keep a value that isn't a web address as an extra attribute and flag it", () => {
    const instance = find(records, "instance", "lantern-space");
    expect(instance.fields.url).toBeNull();
    expect(instance.fields.extraAttributes).toMatchObject({ url: "not a web address" });
    expect(instance.warnings).toContainEqual(
      expect.objectContaining({ code: "invalid_url", manualReview: true }),
    );
  });

  it("keep a date that can't be read as an extra attribute and flag it", () => {
    const instance = find(records, "instance", "lantern-space");
    expect(instance.fields.lastReviewedAt).toBeNull();
    expect(instance.fields.extraAttributes).toMatchObject({ last_updated: "sometime soon" });
    expect(codes(instance)).toContain("invalid_date");
  });

  it("use the key as the name when there is no name, and flag it", () => {
    const instance = find(records, "instance", "lantern-space");
    expect(instance.fields.name).toBe("lantern-space");
    expect(codes(instance)).toContain("missing_value");
  });

  it("only match their tool exactly, flagging a match the old substring rule would have made", () => {
    const instance = find(records, "instance", "lantern-space");
    expect(instance.fields.toolKey).toBe("kettle");
    expect(instance.warnings).toContainEqual(
      expect.objectContaining({ code: "substring_tool_match", manualReview: true }),
    );
  });
});

describe("tool fields found in the current Hub's data", () => {
  const { records, issues } = recordsFromYaml([
    file(
      "tools.yml",
      `
lantern:
  name: Lantern
  escalation_contact: Call the example duty desk.
  license_cost: Example cost per seat
  license_terms: Example annual terms
  technical_lead: Example Lead
  dpia_url: https://dpia.example.com/lantern
  has_had_data_protection_impact_assessment: true
  gds_domain_restricted_sso: false
`,
    ),
  ]);

  it("are read without issues or unknown fields", () => {
    expect(issues).toEqual([]);
    expect(records.flatMap((r) => r.warnings).map((w) => w.code)).not.toContain("unknown_field");
  });

  it("put the escalation contact on the placeholder instance, which the tool page shows", () => {
    expect(find(records, "instance", "lantern").fields.escalationContact).toBe(
      "Call the example duty desk.",
    );
  });

  it("put the licence cost and terms on a contract", () => {
    expect(find(records, "contract", "lantern").fields).toMatchObject({
      toolKey: "lantern",
      cost: "Example cost per seat",
      licenseTerms: "Example annual terms",
    });
    expect(find(records, "instance", "lantern").fields.contractKey).toBe("lantern");
  });

  it("keep fields with no column of their own as the placeholder's extra attributes", () => {
    expect(find(records, "instance", "lantern").fields.extraAttributes).toEqual({
      technical_lead: "Example Lead",
      dpia_url: "https://dpia.example.com/lantern",
      has_had_data_protection_impact_assessment: "true",
      gds_domain_restricted_sso: "false",
    });
  });
});

describe("identity migration statuses", () => {
  it.each([
    ["Not started yet", "not_started"],
    ["Migration to DSIT in progress", "in_progress"],
    ["Migration to DSIT complete", "complete"],
    ["Not applicable", "not_applicable"],
    ["Awaiting IdAM", "in_progress"],
  ])("map %j to %s without a warning", (status, migrationStatus) => {
    const { records } = recordsFromYaml([
      file("tools.yml", `kettle:\n  name: Kettle\n  identity_migration_status: ${status}\n`),
    ]);
    const placeholder = find(records, "instance", "kettle");
    expect(placeholder.fields.migrationStatus).toBe(migrationStatus);
    expect(codes(placeholder)).not.toContain("unmapped_value");
    expect(placeholder.fields.extraAttributes).toEqual({});
  });
});

describe("capabilities, ownership levels, teams and business units", () => {
  const { records, issues } = recordsFromYaml([
    file(
      "capabilities.yml",
      `
note-taking:
  group: Collaboration
  name: Note taking
  description: Writing down example notes together.
  tools:
    - lanternly
    - kettle-board
  comment: |
    We plan to compare example tools.
  weight: 10
  hide_in_navigation: true
`,
    ),
    file(
      "ownership_levels.yml",
      `
owned_by_team:
  name: Team owned
  definition: One example team looks after the tool.
  description: Example description.
  target_state: Example target.
  weight: 2
`,
    ),
    file(
      "products_teams_and_services.yml",
      `
paper-planes:
  name: Paper Planes Team
  purpose: builds example paper planes
  slack_channel: https://example.slack.com/archives/C0000000001
  slack_channel_name: paper-planes
  team_email_address: paper-planes@example.com
  uses:
    - kettle-board
  gh_orgs:
    - example-org
    - not a valid org
  escalation_contact: Call the example on-call rota.
  last_updated: 15/09/2026
  weight: 4
`,
    ),
    file(
      "business_units.yml",
      `
skyward-directorate:
  name: Skyward Directorate
  description: An example directorate.
  lead: Example Person
  url: https://skyward.example.com
  level: directorate
  escalation_contact: Ask the example duty manager.
  weight: 20
  operates:
    - paper-planes
`,
    ),
  ]);

  it("are read without issues", () => {
    expect(issues).toEqual([]);
  });

  it("map capabilities with their tools in order", () => {
    expect(find(records, "capability", "note-taking").fields).toEqual({
      key: "note-taking",
      name: "Note taking",
      description: "Writing down example notes together.",
      groupName: "Collaboration",
      comment: "We plan to compare example tools.",
      weight: 10,
      hideInNavigation: true,
      toolKeys: ["lanternly", "kettle-board"],
    });
  });

  it("normalise ownership level keys", () => {
    expect(find(records, "ownership_level", "owned-by-team").fields).toEqual({
      key: "owned-by-team",
      name: "Team owned",
      definition: "One example team looks after the tool.",
      description: "Example description.",
      targetState: "Example target.",
      weight: 2,
      hideInNavigation: false,
    });
  });

  it("map teams, dropping a GitHub organisation name that isn't valid", () => {
    const team = find(records, "product_team_service", "paper-planes");
    expect(team.fields).toEqual({
      key: "paper-planes",
      slug: "paper-planes",
      name: "Paper Planes Team",
      purpose: "builds example paper planes",
      url: null,
      slackChannel: "https://example.slack.com/archives/C0000000001",
      slackChannelName: "paper-planes",
      teamEmailAddress: "paper-planes@example.com",
      ghOrgs: ["example-org"],
      escalationContact: "Call the example on-call rota.",
      lastReviewedAt: "2026-09-15",
      weight: 4,
      usesToolKeys: ["kettle-board"],
    });
    expect(codes(team)).toContain("invalid_github_org");
  });

  it("map business units with the teams they operate", () => {
    expect(find(records, "business_unit", "skyward-directorate").fields).toEqual({
      key: "skyward-directorate",
      name: "Skyward Directorate",
      level: "directorate",
      description: "An example directorate.",
      lead: "Example Person",
      url: "https://skyward.example.com",
      escalationContact: "Ask the example duty manager.",
      weight: 20,
      operatesKeys: ["paper-planes"],
      childKeys: [],
    });
  });

  it("map the units a business unit lists as its children", () => {
    const { records: units, issues: unitIssues } = recordsFromYaml([
      file(
        "business_units.yml",
        "skyward:\n  name: Skyward\n  operates: []\n  child_units:\n    - cloudward\n    - starward\ncloudward:\n  name: Cloudward\n  operates: []\n",
      ),
    ]);
    expect(unitIssues).toEqual([]);
    expect(find(units, "business_unit", "skyward").fields.childKeys).toEqual([
      "cloudward",
      "starward",
    ]);
    expect(codes(find(units, "business_unit", "skyward"))).not.toContain("unknown_field");
  });
});

describe("problems in the data files", () => {
  it("are reported, without quoting the file, when a file isn't valid YAML", () => {
    const { records, issues } = recordsFromYaml([file("tools.yml", "kettle: [private words\n")]);
    expect(records).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ sourcePath: "tools.yml", sourceType: "yaml" });
    expect(JSON.stringify(issues)).not.toContain("private words");
    // The parser's reason and the line, so the problem can be found.
    expect(issues[0]?.message).toMatch(/isn't valid YAML: .+ at line \d+$/);
  });

  it("are reported when a team's uses or a unit's operates isn't a list", () => {
    const { issues } = recordsFromYaml([
      file("products_teams_and_services.yml", "paper-planes:\n  name: Paper Planes\n"),
      file("business_units.yml", "skyward:\n  name: Skyward\n  operates: paper-planes\n"),
    ]);
    expect(issues.map((issue) => [issue.key, issue.field])).toEqual([
      ["paper-planes", "uses"],
      ["skyward", "operates"],
    ]);
  });

  it("are reported when a boolean field isn't true or false", () => {
    const { issues } = recordsFromYaml([
      file("tools.yml", "kettle:\n  name: Kettle\n  not_in_use: maybe\n"),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ key: "kettle", field: "not_in_use" });
  });

  it("are reported when a record isn't a set of named values", () => {
    const { issues } = recordsFromYaml([file("tools.yml", "kettle: just text\n")]);
    expect(issues[0]).toMatchObject({ key: "kettle" });
  });

  it("are reported for a file the migration doesn't know", () => {
    const { unknownFiles } = recordsFromYaml([file("retired_widgets.yml", "old:\n  name: Old\n")]);
    expect(unknownFiles).toEqual(["retired_widgets.yml"]);
  });

  it("include files with one top-level key wrapping a list of records", () => {
    const { records, issues } = recordsFromYaml([
      file(
        "ownership_levels.yml",
        "levels:\n  - key: undocumented\n    name: No central ownership\n",
      ),
    ]);
    expect(issues).toEqual([]);
    expect(find(records, "ownership_level", "undocumented").fields.name).toBe(
      "No central ownership",
    );
  });
});

describe("duplicate keys", () => {
  const TEXT = [
    "kettle:",
    "  name: First private kettle",
    "quill:",
    "  name: Quill",
    "kettle:",
    "  name: Second private kettle",
    "",
  ].join("\n");

  it("keep the last of two records with the same key, as the current Hub does", () => {
    const { records, issues } = recordsFromYaml([file("tools.yml", TEXT)]);
    expect(issues).toEqual([]);
    expect(
      records.filter((r) => r.targetEntity === "tool").map((r) => [r.key, r.fields.name]),
    ).toEqual([
      ["kettle", "Second private kettle"],
      ["quill", "Quill"],
    ]);
  });

  it("flag the record and the file for manual review, naming the lines", () => {
    const { records, fileWarnings } = recordsFromYaml([file("tools.yml", TEXT)]);
    const duplicate = find(records, "tool", "kettle").warnings.find(
      (w) => w.code === "duplicate_key",
    );
    expect(duplicate).toMatchObject({ manualReview: true });
    expect(duplicate?.message).toContain("lines 1 and 5");
    expect(codes(find(records, "tool", "quill"))).not.toContain("duplicate_key");
    expect(fileWarnings.get("tools.yml")).toEqual([
      expect.objectContaining({ code: "duplicate_key", manualReview: true }),
    ]);
  });

  it("keep the last value of a field given twice in one record, and flag the file", () => {
    const { records, issues, fileWarnings } = recordsFromYaml([
      file("tools.yml", "kettle:\n  name: First\n  name: Second\n"),
    ]);
    expect(issues).toEqual([]);
    expect(find(records, "tool", "kettle").fields.name).toBe("Second");
    expect(fileWarnings.get("tools.yml")?.[0]?.message).toMatch(/at line \d+/);
  });

  it("never quote the file in a warning", () => {
    const { records, fileWarnings } = recordsFromYaml([file("tools.yml", TEXT)]);
    const warnings = [...fileWarnings.values()].flat().concat(records.flatMap((r) => r.warnings));
    expect(JSON.stringify(warnings)).not.toContain("private");
  });

  it("are not flagged in a file without any", () => {
    const { fileWarnings } = recordsFromYaml([TOOLS]);
    expect(fileWarnings.size).toBe(0);
  });
});
