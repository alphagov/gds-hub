import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRepositories,
  type Repositories,
  type TransactionRepositories,
} from "../../src/repositories/index.js";
import { systemActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// Read models for the capability, product team service, business unit and
// vendor pages, and the services directory. Weights are set so that weight
// order differs from name order. All values are invented.

const actor = systemActor("data_migration");

let testDatabase: TestDatabase | undefined;
let repos: Repositories;

async function buildFixtures(r: TransactionRepositories): Promise<void> {
  const vendor = await r.vendors.create({ slug: "orbit-labs", name: "Orbit Labs" }, actor);
  await r.vendors.create({ slug: "quiet-vendor", name: "Quiet Vendor" }, actor);

  const telescope = await r.tools.create(
    {
      key: "telescope",
      slug: "telescope",
      name: "Telescope",
      description: "Looks at stars.",
      vendorId: vendor.id,
    },
    actor,
  );
  const almanac = await r.tools.create(
    { key: "almanac", slug: "almanac", name: "Almanac", vendorId: vendor.id },
    actor,
  );
  const unrelated = await r.tools.create(
    { key: "unrelated", slug: "unrelated", name: "Unrelated" },
    actor,
  );

  const stargazing = await r.capabilities.create(
    {
      key: "stargazing",
      name: "Stargazing",
      groupName: "Astronomy",
      comment: "Buy a bigger telescope.",
    },
    actor,
  );
  await r.capabilities.create({ key: "lonely", name: "Lonely capability" }, actor);
  // Positions put Telescope before Almanac, despite the name order.
  await r.capabilityTools.create(
    { capabilityId: stargazing.id, toolId: telescope.id, position: 0 },
    actor,
  );
  await r.capabilityTools.create(
    { capabilityId: stargazing.id, toolId: almanac.id, position: 1 },
    actor,
  );

  const telescopeMain = await r.instances.create(
    { key: "telescope-main", slug: "telescope-main", name: "Telescope main", toolId: telescope.id },
    actor,
  );
  const almanacSettings = await r.instances.create(
    {
      key: "almanac",
      slug: "almanac",
      name: "Almanac",
      toolId: almanac.id,
      isPlaceholder: true,
    },
    actor,
  );
  const unrelatedInstance = await r.instances.create(
    { key: "unrelated-main", slug: "unrelated-main", name: "Unrelated main", toolId: unrelated.id },
    actor,
  );

  const headquarters = await r.businessUnits.create(
    { key: "headquarters", name: "Headquarters", level: "directorate" },
    actor,
  );
  // Weights put Zeta before Alpha inside Headquarters.
  const zeta = await r.businessUnits.create(
    { key: "zeta-unit", name: "Zeta unit", parentId: headquarters.id, weight: 1 },
    actor,
  );
  const alphaUnit = await r.businessUnits.create(
    { key: "alpha-unit", name: "Alpha unit", parentId: headquarters.id, weight: 2 },
    actor,
  );
  await r.businessUnits.create({ key: "unweighted-unit", name: "Unweighted unit" }, actor);

  const observers = await r.productTeamServices.create(
    {
      key: "observers",
      slug: "observers",
      name: "Observers",
      purpose: "watch the sky",
      weight: 2,
    },
    actor,
  );
  const navigators = await r.productTeamServices.create(
    { key: "navigators", slug: "navigators", name: "Navigators", weight: 1 },
    actor,
  );
  const drifters = await r.productTeamServices.create(
    { key: "drifters", slug: "drifters", name: "Drifters" },
    actor,
  );

  // Observers are in two units; Navigators in one; Drifters in none.
  for (const unit of [zeta, alphaUnit]) {
    await r.businessUnitProductTeamServices.create(
      { businessUnitId: unit.id, productTeamServiceId: observers.id },
      actor,
    );
  }
  await r.businessUnitProductTeamServices.create(
    { businessUnitId: zeta.id, productTeamServiceId: navigators.id },
    actor,
  );

  for (const instance of [telescopeMain, almanacSettings]) {
    await r.productTeamServiceInstances.create(
      { productTeamServiceId: observers.id, instanceId: instance.id },
      actor,
    );
  }
  await r.productTeamServiceInstances.create(
    { productTeamServiceId: drifters.id, instanceId: unrelatedInstance.id },
    actor,
  );

  await r.instanceCapabilities.create(
    {
      instanceId: telescopeMain.id,
      capabilityId: stargazing.id,
      productTeamServiceId: observers.id,
    },
    actor,
  );
  await r.instanceCapabilities.create(
    {
      instanceId: telescopeMain.id,
      capabilityId: stargazing.id,
      productTeamServiceId: navigators.id,
    },
    actor,
  );
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  repos = createRepositories(created.db);
  await repos.transaction(buildFixtures);
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("capability detail", () => {
  it("includes the capability and its tools, in their set position", async () => {
    const detail = await repos.catalogue.getCapabilityDetail("stargazing");

    expect(detail?.capability).toMatchObject({
      name: "Stargazing",
      groupName: "Astronomy",
      comment: "Buy a bigger telescope.",
    });
    expect(detail?.tools).toEqual([
      expect.objectContaining({
        slug: "telescope",
        name: "Telescope",
        description: "Looks at stars.",
      }),
      expect.objectContaining({ slug: "almanac", description: null }),
    ]);
  });

  it("lists who it is provided to, through which instance and tool, by team name", async () => {
    const detail = await repos.catalogue.getCapabilityDetail("stargazing");

    expect(
      detail?.provisions.map((provision) => [
        provision.productTeamService.slug,
        provision.instance.slug,
        provision.instance.tool.slug,
      ]),
    ).toEqual([
      ["navigators", "telescope-main", "telescope"],
      ["observers", "telescope-main", "telescope"],
    ]);
  });

  it("has empty lists for a capability with nothing linked", async () => {
    const detail = await repos.catalogue.getCapabilityDetail("lonely");

    expect(detail?.tools).toEqual([]);
    expect(detail?.provisions).toEqual([]);
  });

  it("is undefined for a key that no capability has", async () => {
    expect(await repos.catalogue.getCapabilityDetail("no-such-capability")).toBeUndefined();
  });
});

describe("product, team or service detail", () => {
  it("lists its business units in weight order", async () => {
    const detail = await repos.catalogue.getProductTeamServiceDetail("observers");

    expect(detail?.productTeamService).toMatchObject({
      name: "Observers",
      purpose: "watch the sky",
    });
    expect(detail?.businessUnits.map((unit) => unit.key)).toEqual(["zeta-unit", "alpha-unit"]);
  });

  it("lists the instances it uses by tool name, marking placeholders", async () => {
    const detail = await repos.catalogue.getProductTeamServiceDetail("observers");

    expect(
      detail?.instances.map((instance) => [
        instance.tool.slug,
        instance.slug,
        instance.isPlaceholder,
      ]),
    ).toEqual([
      ["almanac", "almanac", true],
      ["telescope", "telescope-main", false],
    ]);
  });

  it("lists the capabilities provided to it, with the instance that provides each", async () => {
    const detail = await repos.catalogue.getProductTeamServiceDetail("observers");

    expect(
      detail?.capabilities.map((provided) => [provided.capability.key, provided.instance.slug]),
    ).toEqual([["stargazing", "telescope-main"]]);
  });

  it("has empty lists for a team with nothing linked", async () => {
    const detail = await repos.catalogue.getProductTeamServiceDetail("navigators");

    expect(detail?.instances).toEqual([]);
    expect(detail?.businessUnits.map((unit) => unit.key)).toEqual(["zeta-unit"]);
  });

  it("is undefined for a slug that no team has", async () => {
    expect(await repos.catalogue.getProductTeamServiceDetail("no-such-team")).toBeUndefined();
  });
});

describe("business unit detail", () => {
  it("lists the units inside it in weight order", async () => {
    const detail = await repos.catalogue.getBusinessUnitDetail("headquarters");

    expect(detail?.businessUnit).toMatchObject({ name: "Headquarters", level: "directorate" });
    expect(detail?.parent).toBeNull();
    expect(detail?.children.map((unit) => unit.key)).toEqual(["zeta-unit", "alpha-unit"]);
    expect(detail?.productTeamServices).toEqual([]);
  });

  it("includes its parent and the teams it operates in weight order", async () => {
    const detail = await repos.catalogue.getBusinessUnitDetail("zeta-unit");

    expect(detail?.parent).toMatchObject({ key: "headquarters", name: "Headquarters" });
    expect(detail?.children).toEqual([]);
    expect(detail?.productTeamServices.map((team) => team.slug)).toEqual([
      "navigators",
      "observers",
    ]);
    expect(detail?.productTeamServices[1]).toMatchObject({ purpose: "watch the sky" });
  });

  it("is undefined for a key that no unit has", async () => {
    expect(await repos.catalogue.getBusinessUnitDetail("no-such-unit")).toBeUndefined();
  });
});

describe("vendor detail", () => {
  it("lists the vendor's tools in name order", async () => {
    const detail = await repos.catalogue.getVendorDetail("orbit-labs");

    expect(detail?.vendor.name).toBe("Orbit Labs");
    expect(detail?.tools.map((tool) => tool.slug)).toEqual(["almanac", "telescope"]);
  });

  it("has no tools for a vendor with none", async () => {
    expect((await repos.catalogue.getVendorDetail("quiet-vendor"))?.tools).toEqual([]);
  });

  it("is undefined for a slug that no vendor has", async () => {
    expect(await repos.catalogue.getVendorDetail("no-such-vendor")).toBeUndefined();
  });
});

describe("service directory", () => {
  it("lists every business unit in weight order, with no weight last", async () => {
    const directory = await repos.catalogue.getServiceDirectory();

    expect(directory.businessUnits.map((unit) => unit.key)).toEqual([
      "zeta-unit",
      "alpha-unit",
      "headquarters",
      "unweighted-unit",
    ]);
  });

  it("lists each unit's teams in weight order, repeating a team that is in two units", async () => {
    const directory = await repos.catalogue.getServiceDirectory();
    const teamsByUnit = Object.fromEntries(
      directory.businessUnits.map((unit) => [
        unit.key,
        unit.productTeamServices.map((team) => team.slug),
      ]),
    );

    expect(teamsByUnit).toEqual({
      "zeta-unit": ["navigators", "observers"],
      "alpha-unit": ["observers"],
      headquarters: [],
      "unweighted-unit": [],
    });
  });

  it("lists the teams that are in no business unit", async () => {
    const directory = await repos.catalogue.getServiceDirectory();

    expect(directory.unassigned.map((team) => team.slug)).toEqual(["drifters"]);
  });
});
