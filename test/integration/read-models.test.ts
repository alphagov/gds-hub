import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRepositories,
  type Repositories,
  type TransactionRepositories,
} from "../../src/repositories/index.js";
import { systemActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// One tool with everything linked to it, a second tool whose records must not
// leak into the first, and a bare tool and instance with no links at all. All
// values are invented.

const actor = systemActor("data_migration");

let testDatabase: TestDatabase | undefined;
let repos: Repositories;

const ids = {
  olderContract: 0,
  newerContract: 0,
};

async function buildFixtures(r: TransactionRepositories): Promise<void> {
  const vendor = await r.vendors.create(
    { slug: "acme-cloud", name: "Acme Cloud", url: "https://acme.example.com" },
    actor,
  );
  const supplierOne = await r.suppliers.create({ name: "Reseller One" }, actor);
  const supplierTwo = await r.suppliers.create(
    { name: "Reseller Two", url: "https://reseller-two.example.com" },
    actor,
  );

  const tool = await r.tools.create(
    {
      key: "acme-hosting",
      slug: "acme-hosting",
      name: "Acme Hosting",
      description: "Cloud hosting.",
      vendorId: vendor.id,
    },
    actor,
  );
  // Created in reverse name order, so the test checks the ordering.
  await r.supplierTools.create({ supplierId: supplierTwo.id, toolId: tool.id }, actor);
  await r.supplierTools.create({ supplierId: supplierOne.id, toolId: tool.id }, actor);

  const olderContract = await r.contracts.create(
    {
      toolId: tool.id,
      supplierId: supplierOne.id,
      startDate: "2023-04-01",
      endDate: "2024-03-31",
      cost: "£100",
    },
    actor,
  );
  const newerContract = await r.contracts.create(
    {
      toolId: tool.id,
      supplierId: supplierTwo.id,
      startDate: "2024-04-01",
      endDate: "2029-03-31",
      costModel: "Charged per seat each month.",
      commercials: "Bought through an invented framework.",
      dataProtectionAndSecurity: "Reviewed by the example security team.",
      totalUsers: "About 40",
    },
    actor,
  );
  ids.olderContract = olderContract.id;
  ids.newerContract = newerContract.id;

  const operational = await r.ownershipLevels.create(
    { key: "operational", name: "Operational ownership" },
    actor,
  );
  const undocumented = await r.ownershipLevels.create(
    { key: "undocumented", name: "Undocumented" },
    actor,
  );

  const hosting = await r.capabilities.create(
    { key: "hosting", name: "Hosting", groupName: "Operations" },
    actor,
  );
  const logging = await r.capabilities.create(
    { key: "logging", name: "Logging", groupName: "Operations" },
    actor,
  );
  const backups = await r.capabilities.create({ key: "backups", name: "Backups" }, actor);
  await r.capabilityTools.create({ capabilityId: hosting.id, toolId: tool.id, position: 1 }, actor);
  await r.capabilityTools.create({ capabilityId: logging.id, toolId: tool.id, position: 0 }, actor);
  await r.capabilityTools.create({ capabilityId: backups.id, toolId: tool.id }, actor);

  const main = await r.instances.create(
    {
      key: "acme-hosting-main",
      slug: "acme-hosting-main",
      name: "Acme hosting main",
      toolId: tool.id,
      contractId: newerContract.id,
      gettingAccess: "Ask in the team channel.",
      ownershipLevelId: undocumented.id,
      targetOwnershipLevelId: operational.id,
      extraAttributes: { Region: "eu-west-2" },
    },
    actor,
  );
  const sandbox = await r.instances.create(
    {
      key: "acme-hosting-sandbox",
      slug: "acme-hosting-sandbox",
      name: "Acme hosting sandbox",
      toolId: tool.id,
    },
    actor,
  );
  await r.instances.create(
    {
      key: "acme-hosting-settings",
      slug: "acme-hosting-settings",
      name: "Acme hosting settings",
      toolId: tool.id,
      isPlaceholder: true,
      management: "Managed by the platform team.",
      ownershipLevelId: operational.id,
    },
    actor,
  );

  const north = await r.businessUnits.create({ key: "unit-north", name: "North unit" }, actor);
  const south = await r.businessUnits.create({ key: "unit-south", name: "South unit" }, actor);
  const beta = await r.productTeamServices.create(
    { key: "team-beta", slug: "team-beta", name: "Team Beta" },
    actor,
  );
  const alpha = await r.productTeamServices.create(
    { key: "team-alpha", slug: "team-alpha", name: "Team Alpha" },
    actor,
  );
  for (const unit of [south, north]) {
    await r.businessUnitProductTeamServices.create(
      { businessUnitId: unit.id, productTeamServiceId: alpha.id },
      actor,
    );
  }
  await r.businessUnitProductTeamServices.create(
    { businessUnitId: south.id, productTeamServiceId: beta.id },
    actor,
  );

  // Team Alpha uses two of the tool's instances, so it must still appear once.
  await r.productTeamServiceInstances.create(
    { productTeamServiceId: alpha.id, instanceId: main.id },
    actor,
  );
  await r.productTeamServiceInstances.create(
    { productTeamServiceId: alpha.id, instanceId: sandbox.id },
    actor,
  );
  await r.productTeamServiceInstances.create(
    { productTeamServiceId: beta.id, instanceId: main.id },
    actor,
  );
  await r.instanceCapabilities.create(
    { instanceId: main.id, capabilityId: logging.id, productTeamServiceId: beta.id },
    actor,
  );
  await r.instanceCapabilities.create(
    { instanceId: main.id, capabilityId: hosting.id, productTeamServiceId: alpha.id },
    actor,
  );

  // Another tool, with records that must not appear in Acme Hosting's detail.
  const otherSupplier = await r.suppliers.create({ name: "Other Supplier" }, actor);
  const otherTool = await r.tools.create(
    { key: "other-tool", slug: "other-tool", name: "Other Tool" },
    actor,
  );
  await r.supplierTools.create({ supplierId: otherSupplier.id, toolId: otherTool.id }, actor);
  await r.contracts.create({ toolId: otherTool.id, supplierId: otherSupplier.id }, actor);
  const otherCapability = await r.capabilities.create(
    { key: "other-capability", name: "Other capability" },
    actor,
  );
  await r.capabilityTools.create({ capabilityId: otherCapability.id, toolId: otherTool.id }, actor);
  const otherInstance = await r.instances.create(
    { key: "other-instance", slug: "other-instance", name: "Other instance", toolId: otherTool.id },
    actor,
  );
  const gamma = await r.productTeamServices.create(
    { key: "team-gamma", slug: "team-gamma", name: "Team Gamma" },
    actor,
  );
  await r.productTeamServiceInstances.create(
    { productTeamServiceId: gamma.id, instanceId: otherInstance.id },
    actor,
  );

  // A tool and instance with nothing linked.
  const bareTool = await r.tools.create(
    { key: "bare-tool", slug: "bare-tool", name: "Bare Tool" },
    actor,
  );
  await r.instances.create(
    { key: "bare-instance", slug: "bare-instance", name: "Bare instance", toolId: bareTool.id },
    actor,
  );
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  repos = createRepositories(created.db);
  await repos.transaction(buildFixtures);
});

// If setup failed there's nothing to drop. Vitest reports the setup error.
afterAll(async () => {
  await testDatabase?.drop();
});

async function toolDetail(slug: string) {
  const detail = await repos.catalogue.getToolDetail(slug);
  if (!detail) throw new Error(`expected tool detail for ${slug}`);
  return detail;
}

async function instanceDetail(slug: string) {
  const detail = await repos.catalogue.getInstanceDetail(slug);
  if (!detail) throw new Error(`expected instance detail for ${slug}`);
  return detail;
}

describe("tool detail", () => {
  it("includes the tool and its vendor", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.tool).toMatchObject({
      slug: "acme-hosting",
      name: "Acme Hosting",
      description: "Cloud hosting.",
    });
    expect(detail.vendor).toMatchObject({ slug: "acme-cloud", name: "Acme Cloud" });
  });

  it("lists the tool's suppliers in name order", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.suppliers.map((supplier) => supplier.name)).toEqual([
      "Reseller One",
      "Reseller Two",
    ]);
  });

  it("lists the tool's contracts, newest first, each with its supplier", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.contracts.map((contract) => [contract.id, contract.supplier.name])).toEqual([
      [ids.newerContract, "Reseller Two"],
      [ids.olderContract, "Reseller One"],
    ]);
    expect(detail.contracts[0]).toMatchObject({
      startDate: "2024-04-01",
      endDate: "2029-03-31",
      costModel: "Charged per seat each month.",
      commercials: "Bought through an invented framework.",
      dataProtectionAndSecurity: "Reviewed by the example security team.",
      totalUsers: "About 40",
      supplier: { name: "Reseller Two", url: "https://reseller-two.example.com" },
    });
  });

  it("lists the tool's capabilities in their set position, then by name", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.capabilities.map((capability) => capability.key)).toEqual([
      "logging",
      "hosting",
      "backups",
    ]);
    expect(detail.capabilities[0]).toMatchObject({ name: "Logging", groupName: "Operations" });
  });

  it("lists the tool's instances, including its placeholder, with their ownership levels", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.instances.map((instance) => instance.slug)).toEqual([
      "acme-hosting-main",
      "acme-hosting-sandbox",
      "acme-hosting-settings",
    ]);
    const [main, sandbox, settings] = detail.instances;
    expect(main).toMatchObject({
      gettingAccess: "Ask in the team channel.",
      ownershipLevel: { key: "undocumented", name: "Undocumented" },
      targetOwnershipLevel: { key: "operational", name: "Operational ownership" },
    });
    expect(sandbox).toMatchObject({ ownershipLevel: null, targetOwnershipLevel: null });
    expect(settings).toMatchObject({
      isPlaceholder: true,
      management: "Managed by the platform team.",
      ownershipLevel: { key: "operational" },
    });
  });

  it("lists each team using any of the tool's instances once, with its business units", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.productTeamServices.map((team) => team.slug)).toEqual([
      "team-alpha",
      "team-beta",
    ]);
    expect(detail.productTeamServices[0]?.businessUnits.map((unit) => unit.key)).toEqual([
      "unit-north",
      "unit-south",
    ]);
    expect(detail.productTeamServices[1]?.businessUnits.map((unit) => unit.name)).toEqual([
      "South unit",
    ]);
  });

  it("does not include records linked only to other tools", async () => {
    const detail = await toolDetail("acme-hosting");
    expect(detail.suppliers.map((supplier) => supplier.name)).not.toContain("Other Supplier");
    expect(detail.contracts).toHaveLength(2);
    expect(detail.capabilities.map((capability) => capability.key)).not.toContain(
      "other-capability",
    );
    expect(detail.instances.map((instance) => instance.slug)).not.toContain("other-instance");
    expect(detail.productTeamServices.map((team) => team.slug)).not.toContain("team-gamma");
  });

  it("has no vendor and empty lists for a tool with nothing linked", async () => {
    const detail = await toolDetail("bare-tool");
    expect(detail.vendor).toBeNull();
    expect(detail.suppliers).toEqual([]);
    expect(detail.contracts).toEqual([]);
    expect(detail.capabilities).toEqual([]);
    expect(detail.productTeamServices).toEqual([]);
    expect(detail.instances.map((instance) => instance.slug)).toEqual(["bare-instance"]);
  });

  it("is undefined for a slug that no tool has", async () => {
    expect(await repos.catalogue.getToolDetail("no-such-tool")).toBeUndefined();
  });
});

describe("instance detail", () => {
  it("includes the instance and its tool", async () => {
    const detail = await instanceDetail("acme-hosting-main");
    expect(detail.instance).toMatchObject({
      slug: "acme-hosting-main",
      name: "Acme hosting main",
      extraAttributes: { Region: "eu-west-2" },
    });
    expect(detail.tool).toMatchObject({ slug: "acme-hosting", name: "Acme Hosting" });
  });

  it("includes the instance's contract and its supplier", async () => {
    const detail = await instanceDetail("acme-hosting-main");
    expect(detail.contract).toMatchObject({
      id: ids.newerContract,
      endDate: "2029-03-31",
      commercials: "Bought through an invented framework.",
      supplier: { name: "Reseller Two" },
    });
  });

  it("includes the current and target ownership levels", async () => {
    const detail = await instanceDetail("acme-hosting-main");
    expect(detail.ownershipLevel).toMatchObject({ key: "undocumented", name: "Undocumented" });
    expect(detail.targetOwnershipLevel).toMatchObject({
      key: "operational",
      name: "Operational ownership",
    });
  });

  it("lists the teams that use the instance, with their business units", async () => {
    const detail = await instanceDetail("acme-hosting-main");
    expect(
      detail.productTeamServices.map((team) => [
        team.slug,
        team.businessUnits.map((unit) => unit.key),
      ]),
    ).toEqual([
      ["team-alpha", ["unit-north", "unit-south"]],
      ["team-beta", ["unit-south"]],
    ]);
  });

  it("lists each capability the instance provides with the team it is provided to", async () => {
    const detail = await instanceDetail("acme-hosting-main");
    expect(
      detail.capabilities.map((entry) => [entry.capability.key, entry.productTeamService.slug]),
    ).toEqual([
      ["hosting", "team-alpha"],
      ["logging", "team-beta"],
    ]);
  });

  it("has nulls and empty lists for an instance with nothing linked", async () => {
    const detail = await instanceDetail("bare-instance");
    expect(detail.tool.slug).toBe("bare-tool");
    expect(detail.contract).toBeNull();
    expect(detail.ownershipLevel).toBeNull();
    expect(detail.targetOwnershipLevel).toBeNull();
    expect(detail.productTeamServices).toEqual([]);
    expect(detail.capabilities).toEqual([]);
  });

  it("is undefined for a slug that no instance has", async () => {
    expect(await repos.catalogue.getInstanceDetail("no-such-instance")).toBeUndefined();
  });
});

describe("read models", () => {
  it("are not offered inside a write transaction, so each is read from one snapshot", async () => {
    const offered = await repos.transaction((tx) => Promise.resolve("catalogue" in tx));
    expect(offered).toBe(false);
  });
});
