import { describe, expect, it } from "vitest";
import type { EditValues } from "../../../src/editing/entities.js";
import {
  createPreviewService,
  type PreviewData,
} from "../../../src/services/editing/preview-service.js";
import type { EditRecordDetail } from "../../../src/services/editing/edit-service.js";
import { fakeCatalogue, instanceDetail } from "../catalogue-fixtures.js";
import { fakeContent } from "../content-fixtures.js";
import { CHANGED_AT, fakeEditService, pageDetail, vendorDetail } from "./edit-fixtures.js";

// What a preview shows for each kind of record: the typed values in place of
// the saved ones, everything else as saved, and nothing written. Every name
// and value is invented.

function detailOf(title: string, values: EditRecordDetail["values"], id: number): EditRecordDetail {
  return { id, title, updatedAt: CHANGED_AT, values };
}

/** The saved records the fake edit service knows, by kind and id. */
const SAVED: Readonly<Record<string, EditRecordDetail>> = {
  "vendors:3": vendorDetail(),
  "tools:1": detailOf("Atlas Maker", { slug: "atlas-maker", name: "Atlas Maker" }, 1),
  "tools:2": detailOf("Other Tool", { slug: "other-tool", name: "Other Tool" }, 2),
  "instances:1": detailOf(
    "Atlas Maker main workspace",
    { slug: "atlas-maker-main", name: "Atlas Maker main workspace" },
    1,
  ),
  "services:1": detailOf("Mapping Team", { slug: "mapping-team", name: "Mapping Team" }, 1),
  "pages:5": pageDetail(),
};

function setup(catalogue = fakeCatalogue()) {
  const editing = fakeEditService({
    find: (entity, id) => Promise.resolve(SAVED[`${entity}:${String(id)}`]),
  });
  const service = createPreviewService(catalogue, fakeContent(), editing);
  return { service, editing };
}

/** The preview data, narrowed to the kind the test expects. */
function only<K extends PreviewData["kind"]>(
  data: PreviewData,
  kind: K,
): Extract<PreviewData, { kind: K }> {
  if (data.kind !== kind) throw new Error(`expected a ${kind} preview, got ${data.kind}`);
  return data as Extract<PreviewData, { kind: K }>;
}

const GONE = { kind: "invalid_reference" };

describe("previewing a tool", () => {
  const typed: EditValues = {
    slug: "atlas-maker",
    name: "Atlas Maker Renamed",
    description: "Typed words.",
    engineeringOrBusinessTool: "business",
    vendorId: null,
  };

  it("shows the typed values and keeps what the tool already has", async () => {
    const { service, editing } = setup();

    const data = only(await service.build("tools", 1, typed), "tools");

    expect(data.detail.tool).toMatchObject({
      key: "atlas-maker",
      slug: "atlas-maker",
      name: "Atlas Maker Renamed",
      description: "Typed words.",
      engineeringOrBusinessTool: "business",
    });
    expect(data.detail.capabilities.map(({ name }) => name)).toEqual(["Map making"]);
    expect(data.detail.instances).toHaveLength(1);
    expect(editing.writes).toEqual([]);
  });

  it("shows the vendor that was chosen, and keeps its address from the saved vendor", async () => {
    const { service } = setup();

    const data = only(await service.build("tools", 1, { ...typed, vendorId: 3 }), "tools");

    expect(data.detail.vendor).toMatchObject({ id: 3, slug: "compass-co", name: "Compass Co" });
  });

  it("shows a tool that has not been added yet with nothing else on it", async () => {
    const { service, editing } = setup();

    const data = only(
      await service.build("tools", undefined, { ...typed, slug: "brand-new", name: "Brand New" }),
      "tools",
    );

    expect(data.detail.tool).toMatchObject({ slug: "brand-new", key: "brand-new" });
    expect(data.detail.vendor).toBeNull();
    expect([data.detail.capabilities, data.detail.instances, data.detail.contracts]).toEqual([
      [],
      [],
      [],
    ]);
    expect(editing.writes).toEqual([]);
  });

  it("refuses a vendor that no longer exists", async () => {
    const { service } = setup();

    await expect(service.build("tools", 1, { ...typed, vendorId: 99 })).rejects.toMatchObject(GONE);
  });

  it("says the tool is not found when it has been deleted", async () => {
    const { service } = setup();

    await expect(service.build("tools", 99, typed)).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("previewing an instance", () => {
  const typed: EditValues = {
    slug: "atlas-maker-main",
    name: "Main workspace renamed",
    toolId: 1,
    description: "Typed words.",
    gettingAccess: "Typed access steps.",
  };

  it("shows the typed values and keeps the instance's saved relationships", async () => {
    const { service, editing } = setup();

    const data = only(await service.build("instances", 1, typed), "instances");

    expect(data.detail.instance).toMatchObject({
      key: "atlas-maker-main",
      name: "Main workspace renamed",
      gettingAccess: "Typed access steps.",
    });
    expect(data.detail.tool).toMatchObject({ slug: "atlas-maker", name: "Atlas Maker" });
    expect(editing.writes).toEqual([]);
  });

  it("shows the tool that was chosen when it is changed", async () => {
    const { service } = setup();

    const data = only(await service.build("instances", 1, { ...typed, toolId: 2 }), "instances");

    expect(data.detail.tool).toEqual({
      id: 2,
      key: "other-tool",
      slug: "other-tool",
      name: "Other Tool",
    });
  });

  it("shows a new instance on the tool that was chosen", async () => {
    const { service, editing } = setup();

    const data = only(
      await service.build("instances", undefined, { ...typed, slug: "fresh", toolId: 2 }),
      "instances",
    );

    expect(data.detail.instance).toMatchObject({ slug: "fresh", key: "fresh", toolId: 2 });
    expect(data.detail.tool.name).toBe("Other Tool");
    expect(data.detail.contract).toBeNull();
    expect(editing.writes).toEqual([]);
  });

  it("refuses a tool that no longer exists", async () => {
    const { service } = setup();

    await expect(service.build("instances", 1, { ...typed, toolId: 99 })).rejects.toMatchObject(
      GONE,
    );
  });

  it("refuses a change of tool for an instance that has a contract, as saving would", async () => {
    // The contract is for the saved tool, and the form can't change it.
    const contract = { id: 7 } as unknown as NonNullable<
      ReturnType<typeof instanceDetail>["contract"]
    >;
    const { service } = setup(
      fakeCatalogue({ instance: () => Promise.resolve(instanceDetail({ contract })) }),
    );

    await expect(service.build("instances", 1, { ...typed, toolId: 2 })).rejects.toMatchObject(
      GONE,
    );
    const kept = only(await service.build("instances", 1, typed), "instances");
    expect(kept.detail.contract).toBe(contract);
  });
});

describe("previewing a team or service", () => {
  const typed: EditValues = {
    slug: "mapping-team",
    name: "Mapping Team Renamed",
    purpose: "Typed words.",
  };

  it("shows the typed values with the team's units and published guides as saved", async () => {
    const { service, editing } = setup();

    const data = only(await service.build("services", 1, typed), "services");

    expect(data.detail.productTeamService).toMatchObject({
      key: "mapping-team",
      name: "Mapping Team Renamed",
      purpose: "Typed words.",
    });
    expect(data.detail.businessUnits.map(({ name }) => name)).toEqual(["Exploration"]);
    expect(data.guides.map(({ slug }) => slug)).toEqual(["mapping-quickstart"]);
    expect(editing.writes).toEqual([]);
  });

  it("shows a team that has not been added yet with no units or guides", async () => {
    const { service, editing } = setup();

    const data = only(
      await service.build("services", undefined, { ...typed, slug: "new-team", name: "New Team" }),
      "services",
    );

    expect(data.detail.productTeamService).toMatchObject({ slug: "new-team", key: "new-team" });
    expect([data.detail.businessUnits, data.detail.instances, data.guides]).toEqual([[], [], []]);
    expect(editing.writes).toEqual([]);
  });
});

describe("previewing a content page", () => {
  const typed: EditValues = {
    slug: "device-rules",
    title: "Device rules renamed",
    pageType: "policy",
    bodyMarkdown: "## Typed heading",
    productTeamServiceId: null,
    status: "draft",
  };

  it("shows the typed page in its section, as it is typed", async () => {
    const { service, editing } = setup();

    const data = only(await service.build("pages", 5, typed), "pages");

    expect(data.section).toBe("policies");
    expect(data.notShownToReaders).toBe(false);
    expect(data.detail.page).toMatchObject({ title: "Device rules renamed", status: "draft" });
    expect(data.detail.productTeamService).toBeNull();
    expect(editing.writes).toEqual([]);
  });

  it("shows the owning team that was chosen", async () => {
    const { service } = setup();

    const data = only(
      await service.build("pages", 5, { ...typed, productTeamServiceId: 1 }),
      "pages",
    );

    expect(data.detail.productTeamService).toEqual({
      id: 1,
      key: "mapping-team",
      slug: "mapping-team",
      name: "Mapping Team",
    });
  });

  it("refuses an owning team that no longer exists", async () => {
    const { service } = setup();

    await expect(
      service.build("pages", 5, { ...typed, productTeamServiceId: 99 }),
    ).rejects.toMatchObject(GONE);
  });

  it("notes a page whose type readers can't see yet", async () => {
    const { service } = setup();

    const data = only(await service.build("pages", 5, { ...typed, pageType: "general" }), "pages");

    expect(data.notShownToReaders).toBe(true);
    expect(data.section).toBe("guidance");
  });
});
