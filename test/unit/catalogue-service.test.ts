import { describe, expect, it, vi } from "vitest";
import {
  createCatalogueService,
  type CatalogueRepositories,
} from "../../src/services/catalogue/catalogue-service.js";
import {
  capabilities,
  capabilityDetail,
  serviceDirectory,
  toolDetail,
  toolRecord,
} from "./catalogue-fixtures.js";

// Only the methods the service uses are faked. The cast is confined to here.
function fakeRepositories(): CatalogueRepositories {
  const catalogue = {
    getToolDetail: vi.fn((slug: string) =>
      Promise.resolve(slug === "atlas-maker" ? toolDetail() : undefined),
    ),
    getInstanceDetail: vi.fn(() => Promise.resolve(undefined)),
    getCapabilityDetail: vi.fn(() => Promise.resolve(capabilityDetail())),
    getProductTeamServiceDetail: vi.fn(() => Promise.resolve(undefined)),
    getBusinessUnitDetail: vi.fn(() => Promise.resolve(undefined)),
    getVendorDetail: vi.fn(() => Promise.resolve(undefined)),
    getServiceDirectory: vi.fn(() => Promise.resolve(serviceDirectory)),
  };
  return {
    capabilities: { list: () => Promise.resolve(capabilities) },
    tools: { list: () => Promise.resolve([toolRecord()]) },
    catalogue,
  } as unknown as CatalogueRepositories;
}

describe("catalogue service", () => {
  it("groups the capabilities for navigation, leaving out hidden ones", async () => {
    const service = createCatalogueService(fakeRepositories());

    const groups = await service.capabilityGroups();

    expect(groups.map((group) => group.name)).toEqual(["Cartography"]);
    expect(groups[0]?.capabilities.map((capability) => capability.key)).toEqual([
      "globe-spinning",
      "map-making",
    ]);
  });

  it("looks up a tool by its slug", async () => {
    const service = createCatalogueService(fakeRepositories());

    expect((await service.tool("atlas-maker"))?.tool.name).toBe("Atlas Maker");
    expect(await service.tool("no-such-tool")).toBeUndefined();
  });

  it("lists the tools and the service directory", async () => {
    const service = createCatalogueService(fakeRepositories());

    expect((await service.tools()).map((tool) => tool.slug)).toEqual(["atlas-maker"]);
    expect(await service.serviceDirectory()).toBe(serviceDirectory);
  });
});
