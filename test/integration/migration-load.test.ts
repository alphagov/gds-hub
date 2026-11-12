import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  businessUnitProductTeamServices,
  businessUnits,
  capabilities,
  capabilityTools,
  contracts,
  instances,
  ownershipLevels,
  pages,
  productTeamServiceInstances,
  productTeamServices,
  redirects,
  tools,
} from "../../src/db/schema/index.js";
import { seedDatabase } from "../../src/db/seed/seed.js";
import { FIXTURES_DIR } from "../../src/migration/config.js";
import { buildMigrationPlan, type MigrationPlan } from "../../src/migration/inventory.js";
import { newRunId } from "../../src/migration/load-report.js";
import { MigrationLoadError, loadPlan, type LoadOutcome } from "../../src/migration/loader.js";
import { localSource } from "../../src/migration/storage/index.js";
import { connectRepositories, type RepositoryConnection } from "../../src/repositories/index.js";
import { DATA_MIGRATION_ACTOR_EMAIL, createActor } from "../../src/services/audit/actor.js";
import { fixtureOptions, fixtureSources } from "../unit/migration/helpers.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// The tests in the first describe share one database and run in order: each
// one starts from what the one before it loaded. They change a working copy
// of the fixtures in the temporary directory, never the fixtures themselves.

const EDITOR = createActor({ email: "editor@example.com" });
const workDir = mkdtempSync(path.join(os.tmpdir(), "gds-hub-migration-load-"));
const workingCopy = path.join(workDir, "fixtures");
cpSync(FIXTURES_DIR, workingCopy, { recursive: true });

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** Changes a data file in the working copy. Fails if the text to replace isn't there. */
function editData(file: string, from: string, to: string): void {
  const target = path.join(workingCopy, "hub-data", file);
  const text = readFileSync(target, "utf8");
  if (!text.includes(from)) throw new Error(`${file} doesn't contain the text to change`);
  writeFileSync(target, text.replace(from, to));
}

function appendData(file: string, text: string): void {
  const target = path.join(workingCopy, "hub-data", file);
  writeFileSync(target, `${readFileSync(target, "utf8").trimEnd()}\n${text}`);
}

function workingCopyPlan(): Promise<MigrationPlan> {
  return buildMigrationPlan(
    {
      data: localSource(path.join(workingCopy, "hub-data")),
      build: localSource(path.join(workingCopy, "hub-build")),
    },
    fixtureOptions(),
  );
}

function actions(outcome: LoadOutcome): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of outcome.records) counts[record.action] = (counts[record.action] ?? 0) + 1;
  return counts;
}

function changed(outcome: LoadOutcome) {
  return outcome.records.filter((record) => record.action !== "unchanged");
}

function linkOutcome(outcome: LoadOutcome, table: string) {
  return outcome.links.find((link) => link.table === table);
}

const EXPECTED_ROWS = {
  ownership_levels: 2,
  tools: 3,
  contracts: 1,
  instances: 5,
  capabilities: 2,
  capability_tools: 3,
  product_team_services: 2,
  product_team_service_instances: 2,
  business_units: 1,
  business_unit_product_team_services: 2,
  pages: 8,
  redirects: 28,
} as const;

/** The fixtures' records, before any links: 52 in all. */
const FIXTURE_RECORDS = 52;
/** Every row above has a create entry: the records plus 7 links. */
const FIXTURE_AUDIT_ENTRIES = 59;

describe("loading the fixtures into an empty database", () => {
  let testDb: TestDatabase;
  let connection: RepositoryConnection;
  let plan: MigrationPlan;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    connection = connectRepositories(testDb.url);
    plan = await buildMigrationPlan(fixtureSources(), fixtureOptions());
  });

  afterAll(async () => {
    await connection.close();
    await testDb.drop();
  });

  async function rowCounts(): Promise<Record<string, number>> {
    const { db } = testDb;
    return {
      ownership_levels: await db.$count(ownershipLevels),
      tools: await db.$count(tools),
      contracts: await db.$count(contracts),
      instances: await db.$count(instances),
      capabilities: await db.$count(capabilities),
      capability_tools: await db.$count(capabilityTools),
      product_team_services: await db.$count(productTeamServices),
      product_team_service_instances: await db.$count(productTeamServiceInstances),
      business_units: await db.$count(businessUnits),
      business_unit_product_team_services: await db.$count(businessUnitProductTeamServices),
      pages: await db.$count(pages),
      redirects: await db.$count(redirects),
    };
  }

  const auditCount = () => testDb.db.$count(auditLog);

  async function toolId(key: string): Promise<number> {
    const [row] = await testDb.db.select({ id: tools.id }).from(tools).where(eq(tools.key, key));
    if (row === undefined) throw new Error(`no tool ${key}`);
    return row.id;
  }

  async function capabilityId(key: string): Promise<number> {
    const [row] = await testDb.db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(eq(capabilities.key, key));
    if (row === undefined) throw new Error(`no capability ${key}`);
    return row.id;
  }

  const apply = (from: MigrationPlan = plan): Promise<LoadOutcome> =>
    loadPlan(from, connection.repositories, { apply: true, runId: newRunId(new Date()) });

  it("writes nothing on a dry run, but says what it would create", async () => {
    const outcome = await loadPlan(plan, connection.repositories, {
      apply: false,
      runId: newRunId(new Date()),
    });
    expect(outcome.applied).toBe(false);
    expect(outcome.records).toHaveLength(FIXTURE_RECORDS);
    expect(actions(outcome)).toEqual({ create: FIXTURE_RECORDS });
    expect(linkOutcome(outcome, "capability_tool")).toMatchObject({ added: 3, removed: 0 });

    expect(Object.values(await rowCounts()).every((count) => count === 0)).toBe(true);
    expect(await auditCount()).toBe(0);
  });

  it("creates every record and link, each with an audit entry for this run", async () => {
    const runId = newRunId(new Date());
    const outcome = await loadPlan(plan, connection.repositories, { apply: true, runId });
    expect(outcome.applied).toBe(true);
    expect(actions(outcome)).toEqual({ create: FIXTURE_RECORDS });
    expect(await rowCounts()).toEqual(EXPECTED_ROWS);

    const entries = await testDb.db.select().from(auditLog);
    expect(entries).toHaveLength(FIXTURE_AUDIT_ENTRIES);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: "create",
        actorName: DATA_MIGRATION_ACTOR_EMAIL,
        actorSubject: DATA_MIGRATION_ACTOR_EMAIL,
        requestId: runId,
      });
    }
  });

  it("stores a tool's contract with no supplier, linked from its placeholder instance", async () => {
    const kettleBoard = await toolId("kettle-board");
    const [contract] = await testDb.db
      .select()
      .from(contracts)
      .where(eq(contracts.toolId, kettleBoard));
    expect(contract).toMatchObject({ supplierId: null, costModel: "Per seat" });
    const [placeholder] = await testDb.db
      .select()
      .from(instances)
      .where(eq(instances.key, "kettle-board"));
    expect(placeholder).toMatchObject({
      isPlaceholder: true,
      toolId: kettleBoard,
      contractId: contract?.id,
    });
  });

  it("links each capability to its tools in order", async () => {
    const rows = await testDb.db
      .select({ tool: tools.key, position: capabilityTools.position })
      .from(capabilityTools)
      .innerJoin(tools, eq(tools.id, capabilityTools.toolId))
      .where(eq(capabilityTools.capabilityId, await capabilityId("note-taking")))
      .orderBy(asc(capabilityTools.position));
    expect(rows).toEqual([
      { tool: "lanternly", position: 0 },
      { tool: "kettle-board", position: 1 },
    ]);
  });

  it("links each team to the placeholder instances of the tools it uses", async () => {
    const rows = await testDb.db
      .select({ instance: instances.key, isPlaceholder: instances.isPlaceholder })
      .from(productTeamServiceInstances)
      .innerJoin(instances, eq(instances.id, productTeamServiceInstances.instanceId))
      .innerJoin(
        productTeamServices,
        eq(productTeamServices.id, productTeamServiceInstances.productTeamServiceId),
      )
      .where(eq(productTeamServices.key, "paper-planes"))
      .orderBy(asc(instances.key));
    expect(rows).toEqual([
      { instance: "kettle-board", isPlaceholder: true },
      { instance: "lanternly", isPlaceholder: true },
    ]);
  });

  it("stores pages with their body and published date, and the redirects", async () => {
    const [post] = await testDb.db
      .select()
      .from(pages)
      .where(eq(pages.slug, "trying-out-paper-boats"));
    const record = plan.records.find(
      (r) => r.targetEntity === "page" && r.key === "trying-out-paper-boats",
    );
    expect(post).toMatchObject({
      pageType: "whats_new",
      status: "published",
      bodyMarkdown: record?.bodyMarkdown,
      publishedAt: new Date("2026-03-04T00:00:00.000Z"),
    });

    const [redirect] = await testDb.db
      .select()
      .from(redirects)
      .where(eq(redirects.oldPath, "/tools/lantern-notes-wiki/"));
    expect(redirect?.newPath).toBe("/tools/lanternly");
  });

  it("changes nothing when it is run again", async () => {
    const before = await testDb.db.select({ id: tools.id, updatedAt: tools.updatedAt }).from(tools);
    const entries = await auditCount();

    const outcome = await apply();

    expect(actions(outcome)).toEqual({ unchanged: FIXTURE_RECORDS });
    for (const link of outcome.links)
      expect(link).toMatchObject({ added: 0, removed: 0, updated: 0 });
    expect(await auditCount()).toBe(entries);
    expect(
      await testDb.db.select({ id: tools.id, updatedAt: tools.updatedAt }).from(tools),
    ).toEqual(before);
    expect(await rowCounts()).toEqual(EXPECTED_ROWS);
  });

  it("updates only the record whose data changed, naming the field", async () => {
    editData(
      "tools.yml",
      "Notes and a wiki for example teams.",
      "Notes, a wiki and example lists.",
    );
    const entries = await auditCount();

    const outcome = await apply(await workingCopyPlan());

    expect(changed(outcome)).toEqual([
      { entity: "tool", key: "lanternly", action: "update", changedFields: ["description"] },
    ]);
    expect(await auditCount()).toBe(entries + 1);
    const [latest] = await testDb.db
      .select()
      .from(auditLog)
      .orderBy(sql`${auditLog.id} DESC`)
      .limit(1);
    expect(latest).toMatchObject({
      entityType: "tool",
      action: "update",
      changedFields: ["description"],
    });
  });

  it("removes a link the data no longer has and reorders the rest, auditing both", async () => {
    editData(
      "capabilities.yml",
      "  tools:\n    - lanternly\n    - kettle-board\n",
      "  tools:\n    - kettle-board\n",
    );
    const entries = await auditCount();

    const outcome = await apply(await workingCopyPlan());

    expect(changed(outcome)).toEqual([]);
    expect(linkOutcome(outcome, "capability_tool")).toEqual({
      table: "capability_tool",
      added: 0,
      removed: 1,
      updated: 1,
      unchanged: 1,
    });
    const rows = await testDb.db
      .select({ tool: tools.key, position: capabilityTools.position })
      .from(capabilityTools)
      .innerJoin(tools, eq(tools.id, capabilityTools.toolId))
      .where(eq(capabilityTools.capabilityId, await capabilityId("note-taking")));
    expect(rows).toEqual([{ tool: "kettle-board", position: 0 }]);

    const newEntries = await testDb.db
      .select({ entityType: auditLog.entityType, action: auditLog.action })
      .from(auditLog)
      .orderBy(asc(auditLog.id))
      .offset(entries);
    expect(newEntries).toEqual(
      expect.arrayContaining([
        { entityType: "capability_tool", action: "delete" },
        { entityType: "capability_tool", action: "update" },
      ]),
    );
    expect(newEntries).toHaveLength(2);
  });

  it("sets a business unit's parent from the unit that lists it as a child", async () => {
    appendData(
      "business_units.yml",
      // Every unit needs an operates list, as on the current Hub, even if it's empty.
      "cloudward-group:\n  name: Cloudward Group\n  level: group\n  operates: []\n  child_units:\n    - skyward-directorate\n",
    );

    const outcome = await apply(await workingCopyPlan());

    expect(changed(outcome)).toEqual([
      { entity: "business_unit", key: "cloudward-group", action: "create", changedFields: [] },
      {
        entity: "business_unit",
        key: "skyward-directorate",
        action: "update",
        changedFields: ["parentId"],
      },
    ]);
    const units = await testDb.db
      .select({ id: businessUnits.id, key: businessUnits.key, parentId: businessUnits.parentId })
      .from(businessUnits);
    const group = units.find((unit) => unit.key === "cloudward-group");
    expect(units.find((unit) => unit.key === "skyward-directorate")?.parentId).toBe(group?.id);
  });

  it("skips a record an editor has changed, and keeps the editor's change", async () => {
    const quillstack = await toolId("quillstack");
    await connection.repositories.tools.update(quillstack, { name: "Quillstack (edited)" }, EDITOR);
    editData(
      "tools.yml",
      "description: Builds example pipelines.",
      "description: Builds example releases.",
    );

    const outcome = await apply(await workingCopyPlan());

    expect(changed(outcome)).toEqual([
      {
        entity: "tool",
        key: "quillstack",
        action: "skipped",
        changedFields: [],
        reason: expect.any(String),
      },
    ]);
    const [row] = await testDb.db.select().from(tools).where(eq(tools.id, quillstack));
    expect(row).toMatchObject({
      name: "Quillstack (edited)",
      description: "Builds example pipelines.",
    });
  });

  it("reports a record that's only in the database, and never deletes it", async () => {
    const made = await connection.repositories.tools.create(
      { key: "hand-made-tool", slug: "hand-made-tool", name: "Hand-made tool" },
      EDITOR,
    );

    const outcome = await apply(await workingCopyPlan());

    expect(outcome.onlyInDatabase).toContainEqual({ entity: "tool", key: "hand-made-tool" });
    expect(await connection.repositories.tools.getById(made.id)).toBeDefined();
  });

  it("refuses a plan with validation issues, writing nothing", async () => {
    const broken = path.join(workDir, "broken");
    cpSync(workingCopy, broken, { recursive: true });
    const teams = path.join(broken, "hub-data", "products_teams_and_services.yml");
    writeFileSync(teams, readFileSync(teams, "utf8").replace("- lanternly", "- missing-tool"));
    const brokenPlan = await buildMigrationPlan(
      {
        data: localSource(path.join(broken, "hub-data")),
        build: localSource(path.join(broken, "hub-build")),
      },
      fixtureOptions(),
    );
    const entries = await auditCount();

    await expect(apply(brokenPlan)).rejects.toMatchObject({ reason: "plan_failed" });
    await expect(apply(brokenPlan)).rejects.toBeInstanceOf(MigrationLoadError);
    expect(await auditCount()).toBe(entries);
  });

  it("refuses to run while another run is in progress", async () => {
    await connection.repositories.transaction(async (running) => {
      expect(await running.migration.tryLockRun()).toBe(true);
      await expect(apply(await workingCopyPlan())).rejects.toMatchObject({
        reason: "run_in_progress",
      });
    });
  });
});

describe("loading into a seeded database", () => {
  let testDb: TestDatabase;
  let connection: RepositoryConnection;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    await seedDatabase(testDb.db);
    connection = connectRepositories(testDb.url);
  });

  afterAll(async () => {
    await connection.close();
    await testDb.drop();
  });

  it("is refused, even as a dry run, so seed and migrated data are never mixed", async () => {
    const plan = await buildMigrationPlan(fixtureSources(), fixtureOptions());
    const entries = await testDb.db.$count(auditLog);
    for (const apply of [true, false]) {
      await expect(
        loadPlan(plan, connection.repositories, { apply, runId: newRunId(new Date()) }),
      ).rejects.toMatchObject({ reason: "seeded_database" });
    }
    expect(await testDb.db.$count(auditLog)).toBe(entries);
  });
});
