import { beforeAll, describe, expect, it } from "vitest";
import { buildMigrationPlan, type MigrationPlan } from "../../../src/migration/inventory.js";
import {
  LoadMappingError,
  createLoadMapping,
  type IdLookup,
} from "../../../src/migration/load-mapping.js";
import {
  TARGET_ENTITIES,
  type MigrationRecord,
  type TargetEntity,
} from "../../../src/migration/records.js";
import { fixtureOptions, fixtureSources } from "./helpers.js";

let plan: MigrationPlan;

beforeAll(async () => {
  plan = await buildMigrationPlan(fixtureSources(), fixtureOptions());
});

/** Gives every record an ID, as if it had been loaded: 101, 102... for each type. */
function idsFor(records: readonly MigrationRecord[]): IdLookup {
  const ids = new Map<string, number>();
  const next = new Map<TargetEntity, number>();
  for (const r of records) {
    const id = (next.get(r.targetEntity) ?? 100) + 1;
    next.set(r.targetEntity, id);
    ids.set(`${r.targetEntity}:${r.key}`, id);
  }
  return (entity, key) => ids.get(`${entity}:${key}`);
}

function find(records: readonly MigrationRecord[], entity: TargetEntity, key: string) {
  const found = records.find((r) => r.targetEntity === entity && r.key === key);
  if (found === undefined) throw new Error(`no ${entity} record ${key}`);
  return found;
}

function pick(fields: Readonly<Record<string, unknown>>, names: readonly string[]) {
  return Object.fromEntries(names.map((name) => [name, fields[name]]));
}

function without(fields: Readonly<Record<string, unknown>>, names: readonly string[]) {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => !names.includes(name)));
}

/** A hand-made record, for cases the fixtures don't have. */
function made(
  targetEntity: TargetEntity,
  key: string,
  fields: Record<string, unknown>,
): MigrationRecord {
  return {
    sourcePath: "synthetic.yml",
    sourceType: "yaml",
    targetEntity,
    key,
    slug: key,
    fields,
    warnings: [],
  };
}

describe("the values loaded for each record", () => {
  it("are a tool's own columns, leaving its vendor alone", () => {
    const tool = find(plan.records, "tool", "kettle-board");
    const values = createLoadMapping(plan.records).columnValues(tool, idsFor(plan.records));
    expect(values).toEqual(
      pick(tool.fields, ["key", "slug", "name", "description", "engineeringOrBusinessTool"]),
    );
    expect(values).not.toHaveProperty("vendorId");
  });

  it("are an instance's columns, with its tool, contract and ownership levels found by key", () => {
    const ids = idsFor(plan.records);
    const instance = find(plan.records, "instance", "kettle-board");
    const values = createLoadMapping(plan.records).columnValues(instance, ids);
    expect(values).toMatchObject({
      key: "kettle-board",
      slug: "kettle-board",
      isPlaceholder: true,
      toolId: ids("tool", "kettle-board"),
      contractId: ids("contract", "kettle-board"),
      ownershipLevelId: ids("ownership_level", "team-owned"),
      targetOwnershipLevelId: ids("ownership_level", "team-owned"),
      extraAttributes: instance.fields.extraAttributes,
      migrationStatus: instance.fields.migrationStatus,
    });
    for (const reference of [
      "toolKey",
      "contractKey",
      "ownershipLevelKey",
      "targetOwnershipLevelKey",
    ]) {
      expect(values).not.toHaveProperty(reference);
    }
  });

  it("leave an instance's contract and ownership levels empty when it has none", () => {
    const instance = find(plan.records, "instance", "lanternly-team-space");
    const values = createLoadMapping(plan.records).columnValues(instance, idsFor(plan.records));
    expect(values).toMatchObject({ contractId: null, isPlaceholder: false });
  });

  it("are a contract's columns for its tool, with no supplier", () => {
    const ids = idsFor(plan.records);
    const contract = find(plan.records, "contract", "kettle-board");
    const values = createLoadMapping(plan.records).columnValues(contract, ids);
    expect(values).toEqual({
      ...pick(contract.fields, [
        "startDate",
        "endDate",
        "cost",
        "licenseTerms",
        "costModel",
        "commercials",
        "totalUsers",
        "operationalPolicy",
        "dataProtectionAndSecurity",
      ]),
      toolId: ids("tool", "kettle-board"),
    });
  });

  it("are the columns of ownership levels, capabilities and teams", () => {
    const mapping = createLoadMapping(plan.records);
    const ids = idsFor(plan.records);
    const level = find(plan.records, "ownership_level", "undocumented");
    expect(mapping.columnValues(level, ids)).toEqual(level.fields);
    const capability = find(plan.records, "capability", "note-taking");
    expect(mapping.columnValues(capability, ids)).toEqual(without(capability.fields, ["toolKeys"]));
    const team = find(plan.records, "product_team_service", "paper-planes");
    expect(mapping.columnValues(team, ids)).toEqual(without(team.fields, ["usesToolKeys"]));
  });

  it("are a business unit's columns, with no parent when nothing lists it as a child", () => {
    const unit = find(plan.records, "business_unit", "skyward-directorate");
    expect(createLoadMapping(plan.records).columnValues(unit, idsFor(plan.records))).toEqual({
      ...without(unit.fields, ["operatesKeys", "childKeys"]),
      parentId: null,
    });
  });

  it("are a page's columns and body, with its published date as midnight UTC", () => {
    const mapping = createLoadMapping(plan.records);
    const ids = idsFor(plan.records);
    const post = find(plan.records, "page", "trying-out-paper-boats");
    const values = mapping.columnValues(post, ids);
    expect(values).toMatchObject({
      slug: "trying-out-paper-boats",
      pageType: "whats_new",
      status: "published",
      bodyMarkdown: post.bodyMarkdown,
    });
    expect(values.publishedAt).toEqual(new Date("2026-03-04T00:00:00.000Z"));
    expect(values).not.toHaveProperty("productTeamServiceId");

    expect(
      mapping.columnValues(find(plan.records, "page", "device-policy"), ids).publishedAt,
    ).toBeNull();
  });

  it("are a redirect's old and new paths", () => {
    const redirect = plan.records.find(
      (r) => r.targetEntity === "redirect" && r.key === "/tools/lantern-notes-wiki/",
    );
    if (redirect === undefined) throw new Error("no redirect for the old tool address");
    expect(createLoadMapping(plan.records).columnValues(redirect, idsFor(plan.records))).toEqual({
      oldPath: "/tools/lantern-notes-wiki/",
      newPath: "/tools/lanternly",
    });
  });

  it("fail, naming the record and the missing reference, if a referenced record has no ID", () => {
    const instance = find(plan.records, "instance", "kettle-board-main");
    const noTools: IdLookup = (entity, key) =>
      entity === "tool" ? undefined : idsFor(plan.records)(entity, key);
    expect(() => createLoadMapping(plan.records).columnValues(instance, noTools)).toThrow(
      LoadMappingError,
    );
    expect(() => createLoadMapping(plan.records).columnValues(instance, noTools)).toThrow(
      /instance kettle-board-main.*tool kettle-board/,
    );
  });
});

describe("the links loaded between records", () => {
  it("give each capability its tools in the order the YAML lists them", () => {
    const ids = idsFor(plan.records);
    const links = createLoadMapping(plan.records).linkRows(ids);
    expect(links.capabilityTools).toEqual(
      expect.arrayContaining([
        {
          capabilityId: ids("capability", "note-taking"),
          toolId: ids("tool", "lanternly"),
          position: 0,
        },
        {
          capabilityId: ids("capability", "note-taking"),
          toolId: ids("tool", "kettle-board"),
          position: 1,
        },
        {
          capabilityId: ids("capability", "build-pipelines"),
          toolId: ids("tool", "quillstack"),
          position: 0,
        },
      ]),
    );
    expect(links.capabilityTools).toHaveLength(3);
  });

  it("link each team to the placeholder instance of every tool it uses", () => {
    const ids = idsFor(plan.records);
    const links = createLoadMapping(plan.records).linkRows(ids);
    expect(links.productTeamServiceInstances).toEqual(
      expect.arrayContaining([
        {
          productTeamServiceId: ids("product_team_service", "paper-planes"),
          instanceId: ids("instance", "kettle-board"),
        },
        {
          productTeamServiceId: ids("product_team_service", "paper-planes"),
          instanceId: ids("instance", "lanternly"),
        },
      ]),
    );
    expect(links.productTeamServiceInstances).toHaveLength(2);
  });

  it("use the renamed placeholder when a real instance has the tool's key", () => {
    const records = [
      made("tool", "widget", {}),
      made("instance", "widget", { toolKey: "widget", isPlaceholder: false }),
      made("instance", "widget-tool", { toolKey: "widget", isPlaceholder: true }),
      made("product_team_service", "widget-team", { usesToolKeys: ["widget"] }),
    ];
    const ids = idsFor(records);
    expect(createLoadMapping(records).linkRows(ids).productTeamServiceInstances).toEqual([
      {
        productTeamServiceId: ids("product_team_service", "widget-team"),
        instanceId: ids("instance", "widget-tool"),
      },
    ]);
  });

  it("link each business unit to the teams it operates", () => {
    const ids = idsFor(plan.records);
    const links = createLoadMapping(plan.records).linkRows(ids);
    expect(links.businessUnitProductTeamServices).toEqual(
      expect.arrayContaining([
        {
          businessUnitId: ids("business_unit", "skyward-directorate"),
          productTeamServiceId: ids("product_team_service", "paper-planes"),
        },
        {
          businessUnitId: ids("business_unit", "skyward-directorate"),
          productTeamServiceId: ids("product_team_service", "harbour-desk"),
        },
      ]),
    );
    expect(links.businessUnitProductTeamServices).toHaveLength(2);
  });
});

describe("the order records are loaded in", () => {
  it("puts every record a record refers to before it", () => {
    const order = createLoadMapping(plan.records)
      .loadOrder()
      .map((r) => r.targetEntity);
    const positions = order.map((entity) => TARGET_ENTITIES.indexOf(entity));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(order).toHaveLength(plan.records.length);
  });

  it("puts each business unit after its parent, and sets the parent from its list of child units", () => {
    const records = [
      made("business_unit", "team-level", { childKeys: [], operatesKeys: [] }),
      made("business_unit", "group-level", { childKeys: ["directorate-level"], operatesKeys: [] }),
      made("business_unit", "directorate-level", { childKeys: ["team-level"], operatesKeys: [] }),
    ];
    const mapping = createLoadMapping(records);
    expect(mapping.loadOrder().map((r) => r.key)).toEqual([
      "group-level",
      "directorate-level",
      "team-level",
    ]);
    const ids = idsFor(records);
    expect(
      mapping.columnValues(find(records, "business_unit", "group-level"), ids).parentId,
    ).toBeNull();
    expect(
      mapping.columnValues(find(records, "business_unit", "directorate-level"), ids).parentId,
    ).toBe(ids("business_unit", "group-level"));
    expect(mapping.columnValues(find(records, "business_unit", "team-level"), ids).parentId).toBe(
      ids("business_unit", "directorate-level"),
    );
  });
});
