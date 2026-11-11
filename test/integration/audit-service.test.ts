import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepositories, type Repositories } from "../../src/repositories/index.js";
import { createActor } from "../../src/services/audit/actor.js";
import { createAuditService, type AuditService } from "../../src/services/audit/audit-service.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// Tests in this file share one database. Each test makes its own records.

const editor = createActor({ email: "editor@example.com", requestId: "audit-test-request" });
const otherEditor = createActor({ email: "other.editor@example.com" });
const MISSING_ID = 999_999_999;

let testDatabase: TestDatabase | undefined;
let repos: Repositories;
let audit: AuditService;
let counter = 0;

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function newVendor(description = "Original description") {
  const slug = unique("vendor");
  return repos.vendors.create({ slug, name: `Vendor ${slug}`, description }, editor);
}

function newOwnershipLevel() {
  const key = unique("level");
  return repos.ownershipLevels.create({ key, name: `Level ${key}` }, editor);
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  repos = createRepositories(created.db);
  audit = createAuditService(repos);
});

// If setup failed there's nothing to drop. Vitest reports the setup error.
afterAll(async () => {
  await testDatabase?.drop();
});

describe("history for a record", () => {
  it("lists every change to the record, newest first", async () => {
    const vendor = await newVendor();
    await repos.vendors.update(vendor.id, { description: "Second" }, editor);
    await repos.vendors.update(vendor.id, { description: "Third" }, otherEditor);

    const history = await audit.historyFor("vendor", vendor.id);
    expect(history.map((entry) => entry.action)).toEqual(["update", "update", "create"]);
    expect(history[0]).toMatchObject({
      entityType: "vendor",
      entityId: vendor.id,
      actorName: "other.editor@example.com",
      changedFields: ["description"],
    });
    expect(history[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("shows the previous value of a changed field", async () => {
    const vendor = await newVendor("Before the edit");
    await repos.vendors.update(vendor.id, { description: "After the edit" }, editor);

    const [latest] = await audit.historyFor("vendor", vendor.id);
    expect(latest?.before).toHaveProperty("description", "Before the edit");
    expect(latest?.after).toHaveProperty("description", "After the edit");
  });

  it("only includes changes to the requested record", async () => {
    const vendor = await newVendor();
    const other = await newVendor();
    await repos.vendors.update(other.id, { description: "Changed" }, editor);
    const level = await newOwnershipLevel();

    const history = await audit.historyFor("vendor", vendor.id);
    expect(history).toHaveLength(1);
    expect(history.every((entry) => entry.entityId === vendor.id)).toBe(true);

    const levelHistory = await audit.historyFor("ownership_level", level.id);
    expect(levelHistory.map((entry) => entry.entityType)).toEqual(["ownership_level"]);
  });

  it("is kept after the record is removed", async () => {
    const vendor = await newVendor();
    await repos.vendors.remove(vendor.id, editor);

    const history = await audit.historyFor("vendor", vendor.id);
    expect(history.map((entry) => entry.action)).toEqual(["delete", "create"]);
    expect(history[0]?.before).toHaveProperty("slug", vendor.slug);
  });

  it("is empty for a record that has never existed", async () => {
    expect(await audit.historyFor("vendor", MISSING_ID)).toEqual([]);
  });

  it("does not include updates that changed nothing", async () => {
    const vendor = await newVendor("Same");
    await repos.vendors.update(vendor.id, { description: "Same" }, editor);
    expect(await audit.historyFor("vendor", vendor.id)).toHaveLength(1);
  });

  it("puts a change made late in a long transaction after one committed while it was open", async () => {
    const vendor = await newVendor();
    await repos.transaction(async (tx) => {
      await tx.vendors.getById(vendor.id);
      // Make sure the other change is clearly later than this transaction's start.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await repos.vendors.update(
        vendor.id,
        { description: "Saved while the transaction was open" },
        otherEditor,
      );
      await tx.vendors.update(vendor.id, { description: "Saved last" }, editor);
    });

    const history = await audit.historyFor("vendor", vendor.id);
    expect(history.map((entry) => entry.after?.description)).toEqual([
      "Saved last",
      "Saved while the transaction was open",
      "Original description",
    ]);
    expect(await audit.lastUpdated("vendor", vendor.id)).toMatchObject({
      by: "editor@example.com",
      action: "update",
    });
  });

  it("lists changes made in one transaction newest first", async () => {
    const vendor = await newVendor();
    await repos.transaction(async (tx) => {
      await tx.vendors.update(vendor.id, { description: "First in the transaction" }, editor);
      await tx.vendors.update(vendor.id, { description: "Second in the transaction" }, editor);
    });

    const history = await audit.historyFor("vendor", vendor.id);
    expect(history.map((entry) => entry.after?.description)).toEqual([
      "Second in the transaction",
      "First in the transaction",
      "Original description",
    ]);
  });

  it("can be limited to the most recent changes", async () => {
    const vendor = await newVendor();
    await repos.vendors.update(vendor.id, { description: "Second" }, editor);
    await repos.vendors.update(vendor.id, { description: "Third" }, editor);

    const history = await audit.historyFor("vendor", vendor.id, { limit: 2 });
    expect(history.map((entry) => entry.after?.description)).toEqual(["Third", "Second"]);
  });

  it("refuses a limit that is not a positive whole number", async () => {
    await expect(audit.historyFor("vendor", 1, { limit: 0 })).rejects.toThrow(RangeError);
    await expect(audit.historyFor("vendor", 1, { limit: 2.5 })).rejects.toThrow(RangeError);
  });
});

describe("recent changes", () => {
  it("lists changes to every type of record, newest first", async () => {
    const vendor = await newVendor();
    const level = await newOwnershipLevel();
    await repos.vendors.update(vendor.id, { description: "Changed" }, editor);

    const recent = await audit.recentChanges({ limit: 3 });
    expect(recent.map((entry) => [entry.entityType, entry.entityId, entry.action])).toEqual([
      ["vendor", vendor.id, "update"],
      ["ownership_level", level.id, "create"],
      ["vendor", vendor.id, "create"],
    ]);
  });

  it("can be filtered to some types of record", async () => {
    await newVendor();
    const level = await newOwnershipLevel();
    await newVendor();

    const recent = await audit.recentChanges({ entityTypes: ["ownership_level"] });
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((entry) => entry.entityType === "ownership_level")).toBe(true);
    expect(recent[0]?.entityId).toBe(level.id);
  });

  it("returns nothing when filtered to no types of record", async () => {
    await newVendor();
    expect(await audit.recentChanges({ entityTypes: [] })).toEqual([]);
  });

  describe("with more than 100 changes recorded", () => {
    beforeAll(async () => {
      await repos.transaction(async (tx) => {
        for (let i = 0; i < 101; i += 1) {
          const key = unique("bulk-capability");
          await tx.capabilities.create({ key, name: `Capability ${key}` }, editor);
        }
      });
    });

    it("returns 20 changes unless asked for a different number", async () => {
      expect(await audit.recentChanges()).toHaveLength(20);
    });

    it("returns at most 100 changes, however many are asked for", async () => {
      expect(await audit.recentChanges({ limit: 1000 })).toHaveLength(100);
    });
  });

  it("refuses a limit that is not a positive whole number", async () => {
    await expect(audit.recentChanges({ limit: -1 })).rejects.toThrow(RangeError);
    await expect(audit.recentChanges({ limit: 1.5 })).rejects.toThrow(RangeError);
  });
});

describe("last updated", () => {
  it("gives the time, editor and kind of the latest change", async () => {
    const vendor = await newVendor();
    const { record } = await repos.vendors.update(
      vendor.id,
      { description: "Changed" },
      otherEditor,
    );

    expect(await audit.lastUpdated("vendor", vendor.id)).toEqual({
      at: record.updatedAt,
      by: "other.editor@example.com",
      action: "update",
    });
  });

  it("is the creation for a record that has not been edited", async () => {
    const vendor = await newVendor();
    expect(await audit.lastUpdated("vendor", vendor.id)).toEqual({
      at: vendor.createdAt,
      by: "editor@example.com",
      action: "create",
    });
  });

  it("moves on after an edit", async () => {
    const vendor = await newVendor();
    const first = await audit.lastUpdated("vendor", vendor.id);
    await repos.vendors.update(vendor.id, { description: "Changed" }, editor);
    const second = await audit.lastUpdated("vendor", vendor.id);

    expect(first?.action).toBe("create");
    expect(second?.action).toBe("update");
    expect(second?.at.getTime()).toBeGreaterThanOrEqual(first?.at.getTime() ?? Infinity);
  });

  it("does not move on after an update that changed nothing", async () => {
    const vendor = await newVendor("Same");
    await repos.vendors.update(vendor.id, { description: "Same" }, otherEditor);
    expect(await audit.lastUpdated("vendor", vendor.id)).toMatchObject({
      by: "editor@example.com",
      action: "create",
    });
  });

  it("is undefined for a record with no history", async () => {
    expect(await audit.lastUpdated("vendor", MISSING_ID)).toBeUndefined();
  });
});
