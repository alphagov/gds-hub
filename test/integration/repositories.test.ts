import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { auditLog } from "../../src/db/schema/index.js";
import {
  createRepositories,
  RepositoryError,
  type Repositories,
} from "../../src/repositories/index.js";
import { ActorError, createActor, systemActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// Tests in this file share one database. Each test makes its own records with
// unique slugs and keys, so the tests don't depend on each other.

const editor = createActor({ email: "editor@example.com", requestId: "test-request-1" });
const otherEditor = createActor({ email: "other.editor@example.com" });

/** An audit entry with this change summary breaks a constraint added to the test database. */
const REJECTED_SUMMARY = "reject this audit entry";
const MISSING_ID = 999_999_999;

type NewVendor = Parameters<Repositories["vendors"]["create"]>[0];

let testDatabase: TestDatabase | undefined;
let db: Database;
let repos: Repositories;
let counter = 0;

function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** A value as it is stored in audit_log's jsonb columns. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function auditEntriesFor(entityType: string, entityId: number) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(auditLog.id);
}

async function onlyEntry(entityType: string, entityId: number, action: string) {
  const entries = (await auditEntriesFor(entityType, entityId)).filter(
    (entry) => entry.action === action,
  );
  expect(entries).toHaveLength(1);
  const [entry] = entries;
  if (!entry) throw new Error(`expected a ${action} audit entry`);
  return entry;
}

function newVendor(overrides: Partial<NewVendor> = {}) {
  const slug = unique("vendor");
  return repos.vendors.create({ slug, name: `Vendor ${slug}`, ...overrides }, editor);
}

function newTool(vendorId: number | null = null) {
  const key = unique("tool");
  return repos.tools.create({ key, slug: key, name: `Tool ${key}`, vendorId }, editor);
}

async function newInstance(extraAttributes: Record<string, string> = {}) {
  const tool = await newTool();
  const key = unique("instance");
  return repos.instances.create(
    { key, slug: key, name: `Instance ${key}`, toolId: tool.id, extraAttributes },
    editor,
  );
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  db = created.db;
  repos = createRepositories(db);
  // Lets a test make the audit insert fail after the record itself has been
  // written. Only this throwaway database has the constraint.
  await db.execute(
    sql.raw(
      `ALTER TABLE audit_log ADD CONSTRAINT test_rejects_marked_entries
       CHECK (change_summary IS DISTINCT FROM '${REJECTED_SUMMARY}')`,
    ),
  );
});

// If setup failed there's nothing to drop. Vitest reports the setup error.
afterAll(async () => {
  await testDatabase?.drop();
});

describe("creating a record", () => {
  it("returns the new record with its id and timestamps", async () => {
    const vendor = await newVendor({ description: "Makes things" });
    expect(vendor.id).toEqual(expect.any(Number));
    expect(vendor.description).toBe("Makes things");
    expect(vendor.createdAt).toBeInstanceOf(Date);
    expect(vendor.updatedAt).toEqual(vendor.createdAt);
  });

  it("stores an audit entry with no before value and the full record after", async () => {
    const vendor = await newVendor({ supportContact: "support@example.com" });
    const entry = await onlyEntry("vendor", vendor.id, "create");
    expect(entry.before).toBeNull();
    expect(entry.after).toEqual(asJson(vendor));
  });

  it("stores the record with the same field names the code uses", async () => {
    const vendor = await newVendor({ supportContact: "support@example.com" });
    const entry = await onlyEntry("vendor", vendor.id, "create");
    expect(entry.after).toHaveProperty("supportContact", "support@example.com");
    expect(entry.after).not.toHaveProperty("support_contact");
  });

  it("lists every field as changed", async () => {
    const vendor = await newVendor();
    const entry = await onlyEntry("vendor", vendor.id, "create");
    expect([...entry.changedFields].sort()).toEqual(Object.keys(vendor).sort());
  });

  it("records the editor's email, request ID and change summary", async () => {
    const slug = unique("vendor");
    const vendor = await repos.vendors.create({ slug, name: `Vendor ${slug}` }, editor, {
      changeSummary: "Added a new vendor",
    });
    const entry = await onlyEntry("vendor", vendor.id, "create");
    expect(entry).toMatchObject({
      entityType: "vendor",
      entityId: vendor.id,
      actorName: "editor@example.com",
      actorSubject: "editor@example.com",
      requestId: "test-request-1",
      changeSummary: "Added a new vendor",
    });
  });

  it("records an actor with no request ID", async () => {
    const slug = unique("vendor");
    const vendor = await repos.vendors.create({ slug, name: `Vendor ${slug}` }, otherEditor);
    const entry = await onlyEntry("vendor", vendor.id, "create");
    expect(entry).toMatchObject({ requestId: null, changeSummary: null });
  });

  it("records the data migration as the actor for migrated records", async () => {
    const slug = unique("vendor");
    const vendor = await repos.vendors.create(
      { slug, name: `Vendor ${slug}` },
      systemActor("data_migration"),
    );
    const entry = await onlyEntry("vendor", vendor.id, "create");
    expect(entry).toMatchObject({
      actorName: "system:data_migration",
      actorSubject: "system:data_migration",
    });
  });

  it("ignores an id or timestamps supplied by the caller", async () => {
    const slug = unique("vendor");
    const vendor = await repos.vendors.create(
      {
        slug,
        name: `Vendor ${slug}`,
        id: MISSING_ID,
        createdAt: new Date("2000-01-01T00:00:00Z"),
        updatedAt: new Date("2000-01-01T00:00:00Z"),
      } as NewVendor,
      editor,
    );
    expect(vendor.id).not.toBe(MISSING_ID);
    expect(vendor.createdAt.getUTCFullYear()).not.toBe(2000);
    expect(vendor.updatedAt.getUTCFullYear()).not.toBe(2000);
  });
});

describe("updating a record", () => {
  it("stores before and after values", async () => {
    const vendor = await newVendor({ description: "Old description" });
    const { record } = await repos.vendors.update(
      vendor.id,
      { description: "New description" },
      editor,
    );
    const entry = await onlyEntry("vendor", vendor.id, "update");
    expect(entry.before).toEqual(asJson(vendor));
    expect(entry.after).toEqual(asJson(record));
    expect(entry.before).toHaveProperty("description", "Old description");
    expect(entry.after).toHaveProperty("description", "New description");
  });

  it("lists only the fields that changed, not updated_at", async () => {
    const vendor = await newVendor({ description: "Old", url: "https://example.com" });
    await repos.vendors.update(
      vendor.id,
      { description: "New", url: "https://example.com", supportContact: "help@example.com" },
      editor,
    );
    const entry = await onlyEntry("vendor", vendor.id, "update");
    expect([...entry.changedFields].sort()).toEqual(["description", "supportContact"]);
  });

  it("returns the updated record and the changed fields", async () => {
    const vendor = await newVendor();
    const result = await repos.vendors.update(vendor.id, { description: "Changed" }, editor);
    expect(result.record).toMatchObject({ id: vendor.id, description: "Changed" });
    expect(result.changedFields).toEqual(["description"]);
  });

  it("sets updated_at to the time of the change, as recorded in the audit entry", async () => {
    const vendor = await newVendor();
    const { record } = await repos.vendors.update(vendor.id, { description: "Changed" }, editor);
    const entry = await onlyEntry("vendor", vendor.id, "update");
    expect(record.updatedAt).toEqual(entry.createdAt);
    expect(record.updatedAt.getTime()).toBeGreaterThanOrEqual(vendor.updatedAt.getTime());
    expect(record.createdAt).toEqual(vendor.createdAt);
  });

  it("records the editor and change summary for the update", async () => {
    const vendor = await newVendor();
    await repos.vendors.update(vendor.id, { description: "Changed" }, otherEditor, {
      changeSummary: "Fixed the description",
    });
    const entry = await onlyEntry("vendor", vendor.id, "update");
    expect(entry).toMatchObject({
      actorName: "other.editor@example.com",
      actorSubject: "other.editor@example.com",
      changeSummary: "Fixed the description",
    });
  });

  it("an update that changes nothing writes no audit entry and keeps updated_at", async () => {
    const vendor = await newVendor({ description: "Same" });
    const result = await repos.vendors.update(vendor.id, { description: "Same" }, editor);
    expect(result.changedFields).toEqual([]);
    expect(result.record).toEqual(vendor);
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
    expect(await auditEntriesFor("vendor", vendor.id)).toHaveLength(1);
  });

  it("an update with no fields writes no audit entry", async () => {
    const vendor = await newVendor();
    const result = await repos.vendors.update(vendor.id, {}, editor);
    expect(result.changedFields).toEqual([]);
    expect(await auditEntriesFor("vendor", vendor.id)).toHaveLength(1);
  });

  it("an update that only reorders a JSON object's keys writes no audit entry", async () => {
    const instance = await newInstance({ Region: "eu-west-2", Tier: "Enterprise" });
    const result = await repos.instances.update(
      instance.id,
      { extraAttributes: { Tier: "Enterprise", Region: "eu-west-2" } },
      editor,
    );
    expect(result.changedFields).toEqual([]);
    expect(await auditEntriesFor("instance", instance.id)).toHaveLength(1);
  });

  it("an update to a JSON object stores the old and new objects", async () => {
    const instance = await newInstance({ Region: "eu-west-2" });
    await repos.instances.update(instance.id, { extraAttributes: { Region: "eu-west-1" } }, editor);
    const entry = await onlyEntry("instance", instance.id, "update");
    expect(entry.changedFields).toEqual(["extraAttributes"]);
    expect(entry.before).toHaveProperty("extraAttributes", { Region: "eu-west-2" });
    expect(entry.after).toHaveProperty("extraAttributes", { Region: "eu-west-1" });
  });

  it("an update that sets an unchanged date writes no audit entry", async () => {
    const instance = await newInstance();
    await repos.instances.update(instance.id, { lastReviewedAt: "2026-10-01" }, editor);
    const result = await repos.instances.update(
      instance.id,
      { lastReviewedAt: "2026-10-01" },
      editor,
    );
    expect(result.changedFields).toEqual([]);
    expect(await auditEntriesFor("instance", instance.id)).toHaveLength(2);
  });

  it("ignores attempts to change the id or timestamps", async () => {
    const vendor = await newVendor();
    const result = await repos.vendors.update(
      vendor.id,
      { id: MISSING_ID, createdAt: new Date("2000-01-01T00:00:00Z") } as Partial<NewVendor>,
      editor,
    );
    expect(result.changedFields).toEqual([]);
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
  });

  it("dates a change by when it was made, not when its transaction started", async () => {
    const vendor = await newVendor();
    let committedMeanwhile: Date | undefined;
    const { record } = await repos.transaction(async (tx) => {
      await tx.vendors.getById(vendor.id);
      // Make sure the other change is clearly later than this transaction's start.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const other = await repos.vendors.update(
        vendor.id,
        { description: "Saved while the transaction was open" },
        otherEditor,
      );
      committedMeanwhile = other.record.updatedAt;
      return tx.vendors.update(vendor.id, { description: "Saved last" }, editor);
    });

    expect(committedMeanwhile).toBeDefined();
    expect(record.updatedAt.getTime()).toBeGreaterThanOrEqual(committedMeanwhile?.getTime() ?? 0);
    const [latest] = (await auditEntriesFor("vendor", vendor.id)).reverse();
    expect(latest?.createdAt).toEqual(record.updatedAt);
  });

  it("each of two concurrent updates records the value it replaced", async () => {
    const vendor = await newVendor();
    await Promise.all([
      repos.vendors.update(vendor.id, { description: "First change" }, editor),
      repos.vendors.update(vendor.id, { supportContact: "Second change" }, otherEditor),
    ]);
    const updates = (await auditEntriesFor("vendor", vendor.id)).filter(
      (entry) => entry.action === "update",
    );
    expect(updates).toHaveLength(2);
    expect(updates[1]?.before).toEqual(updates[0]?.after);
    expect(await repos.vendors.getById(vendor.id)).toMatchObject({
      description: "First change",
      supportContact: "Second change",
    });
  });

  it("fails as not found for a record that does not exist, and audits nothing", async () => {
    const before = await db.$count(auditLog);
    const update = repos.vendors.update(MISSING_ID, { description: "Changed" }, editor);
    await expect(update).rejects.toBeInstanceOf(RepositoryError);
    await expect(update).rejects.toMatchObject({ kind: "not_found", entityType: "vendor" });
    expect(await db.$count(auditLog)).toBe(before);
  });
});

describe("removing a record", () => {
  it("stores the full record as the before value and no after value", async () => {
    const vendor = await newVendor({ description: "Going away" });
    await repos.vendors.remove(vendor.id, editor, { changeSummary: "No longer used" });
    const entry = await onlyEntry("vendor", vendor.id, "delete");
    expect(entry.before).toEqual(asJson(vendor));
    expect(entry.after).toBeNull();
    expect([...entry.changedFields].sort()).toEqual(Object.keys(vendor).sort());
    expect(entry).toMatchObject({
      actorSubject: "editor@example.com",
      changeSummary: "No longer used",
    });
  });

  it("returns the removed record, which can no longer be found", async () => {
    const vendor = await newVendor();
    expect(await repos.vendors.remove(vendor.id, editor)).toEqual(vendor);
    expect(await repos.vendors.getById(vendor.id)).toBeUndefined();
  });

  it("keeps the record's history after it is removed", async () => {
    const vendor = await newVendor();
    await repos.vendors.update(vendor.id, { description: "Changed" }, editor);
    await repos.vendors.remove(vendor.id, editor);
    const actions = (await auditEntriesFor("vendor", vendor.id)).map((entry) => entry.action);
    expect(actions).toEqual(["create", "update", "delete"]);
  });

  it("fails as not found for a record that does not exist, and audits nothing", async () => {
    const before = await db.$count(auditLog);
    await expect(repos.vendors.remove(MISSING_ID, editor)).rejects.toMatchObject({
      kind: "not_found",
      entityType: "vendor",
    });
    expect(await db.$count(auditLog)).toBe(before);
  });

  it("refuses to remove a record that is still in use, and audits nothing", async () => {
    const vendor = await newVendor();
    await newTool(vendor.id);
    await expect(repos.vendors.remove(vendor.id, editor)).rejects.toMatchObject({
      kind: "in_use",
      entityType: "vendor",
    });
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
    expect((await auditEntriesFor("vendor", vendor.id)).map((entry) => entry.action)).toEqual([
      "create",
    ]);
  });

  it("removes a link between records and audits it", async () => {
    const tool = await newTool();
    const supplier = await repos.suppliers.create({ name: unique("Supplier") }, editor);
    const link = await repos.supplierTools.create(
      { supplierId: supplier.id, toolId: tool.id },
      editor,
    );
    await repos.supplierTools.remove(link.id, editor);
    const entry = await onlyEntry("supplier_tool", link.id, "delete");
    expect(entry.before).toMatchObject({ supplierId: supplier.id, toolId: tool.id });
  });

  it("removes and audits the links that would otherwise be deleted with it", async () => {
    const tool = await newTool();
    const supplier = await repos.suppliers.create({ name: unique("Supplier") }, editor);
    const link = await repos.supplierTools.create(
      { supplierId: supplier.id, toolId: tool.id },
      editor,
    );

    await repos.suppliers.remove(supplier.id, editor, { changeSummary: "No longer used" });

    expect(await repos.supplierTools.getById(link.id)).toBeUndefined();
    const entry = await onlyEntry("supplier_tool", link.id, "delete");
    expect(entry).toMatchObject({
      actorSubject: "editor@example.com",
      requestId: "test-request-1",
      changeSummary: `Removed with supplier ${supplier.id}`,
    });
    expect(entry.before).toMatchObject({ supplierId: supplier.id, toolId: tool.id });
    await onlyEntry("supplier", supplier.id, "delete");
  });

  it("removes and audits links in every table that depends on the record", async () => {
    const instance = await newInstance();
    const key = unique("team");
    const team = await repos.productTeamServices.create(
      { key, slug: key, name: `Team ${key}` },
      editor,
    );
    const capabilityKey = unique("capability");
    const capability = await repos.capabilities.create(
      { key: capabilityKey, name: `Capability ${capabilityKey}` },
      editor,
    );
    const usage = await repos.productTeamServiceInstances.create(
      { productTeamServiceId: team.id, instanceId: instance.id },
      editor,
    );
    const provided = await repos.instanceCapabilities.create(
      { instanceId: instance.id, capabilityId: capability.id, productTeamServiceId: team.id },
      editor,
    );

    await repos.instances.remove(instance.id, editor);

    await onlyEntry("product_team_service_instance", usage.id, "delete");
    await onlyEntry("instance_capability", provided.id, "delete");
    expect(await repos.productTeamServices.getById(team.id)).toEqual(team);
    expect(await repos.capabilities.getById(capability.id)).toEqual(capability);
  });

  it("keeps its links if the record itself can't be removed", async () => {
    const tool = await newTool();
    const supplier = await repos.suppliers.create({ name: unique("Supplier") }, editor);
    const link = await repos.supplierTools.create(
      { supplierId: supplier.id, toolId: tool.id },
      editor,
    );
    // An instance stops the tool being removed.
    const key = unique("instance");
    await repos.instances.create({ key, slug: key, name: "Instance", toolId: tool.id }, editor);

    await expect(repos.tools.remove(tool.id, editor)).rejects.toMatchObject({
      kind: "in_use",
    });

    expect(await repos.supplierTools.getById(link.id)).toEqual(link);
    expect((await auditEntriesFor("supplier_tool", link.id)).map((entry) => entry.action)).toEqual([
      "create",
    ]);
  });
});

describe("when the audit entry can't be written", () => {
  it("failed audit insert rolls back a create", async () => {
    const slug = unique("vendor");
    await expect(
      repos.vendors.create({ slug, name: `Vendor ${slug}` }, editor, {
        changeSummary: REJECTED_SUMMARY,
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(await repos.vendors.getBySlug(slug)).toBeUndefined();
  });

  it("failed audit insert rolls back an update", async () => {
    const vendor = await newVendor({ description: "Original" });
    await expect(
      repos.vendors.update(vendor.id, { description: "Changed" }, editor, {
        changeSummary: REJECTED_SUMMARY,
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
    expect(await auditEntriesFor("vendor", vendor.id)).toHaveLength(1);
  });

  it("failed audit insert rolls back a removal", async () => {
    const vendor = await newVendor();
    await expect(
      repos.vendors.remove(vendor.id, editor, { changeSummary: REJECTED_SUMMARY }),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
  });
});

describe("when the database rejects the write", () => {
  it("reports a duplicate slug as a duplicate, and audits nothing", async () => {
    const vendor = await newVendor();
    const before = await db.$count(auditLog);
    await expect(
      repos.vendors.create({ slug: vendor.slug, name: unique("Another vendor") }, editor),
    ).rejects.toMatchObject({
      kind: "duplicate",
      entityType: "vendor",
      constraint: "vendors_slug_unique",
    });
    expect(await db.$count(auditLog)).toBe(before);
  });

  it("reports a link to a record that doesn't exist as an invalid reference", async () => {
    const key = unique("tool");
    await expect(
      repos.tools.create({ key, slug: key, name: "Tool", vendorId: MISSING_ID }, editor),
    ).rejects.toMatchObject({ kind: "invalid_reference", entityType: "tool" });
  });

  it("reports a value that breaks a check as an invalid value", async () => {
    await expect(
      repos.vendors.create({ slug: "Not Kebab Case", name: unique("Vendor") }, editor),
    ).rejects.toMatchObject({ kind: "invalid_value", constraint: "vendors_slug_format" });
  });

  it("reports an invalid value in an update and leaves the record unchanged", async () => {
    const vendor = await newVendor();
    await expect(
      repos.vendors.update(vendor.id, { url: "javascript:alert(1)" }, editor),
    ).rejects.toMatchObject({ kind: "invalid_value", constraint: "vendors_url_format" });
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
  });

  it("does not put the values that were written in the error message", async () => {
    const name = `Confidential vendor name ${unique("value")}`;
    await newVendor({ name });
    const error: unknown = await repos.vendors
      .create({ slug: unique("vendor"), name }, editor)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RepositoryError);
    expect((error as RepositoryError).message).not.toContain(name);
  });
});

describe("a write by an invalid actor", () => {
  it("is refused and changes nothing", async () => {
    const vendor = await newVendor();
    const before = await db.$count(auditLog);
    await expect(
      repos.vendors.update(vendor.id, { description: "Changed" }, { email: "" }),
    ).rejects.toBeInstanceOf(ActorError);
    await expect(
      repos.vendors.create(
        { slug: unique("vendor"), name: unique("Vendor") },
        {
          email: "not-an-email",
        },
      ),
    ).rejects.toBeInstanceOf(ActorError);
    await expect(repos.vendors.remove(vendor.id, { email: " " })).rejects.toBeInstanceOf(
      ActorError,
    );
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
    expect(await db.$count(auditLog)).toBe(before);
  });
});

describe("reading records", () => {
  it("finds a record by id, or returns undefined if there is none", async () => {
    const vendor = await newVendor();
    expect(await repos.vendors.getById(vendor.id)).toEqual(vendor);
    expect(await repos.vendors.getById(MISSING_ID)).toBeUndefined();
  });

  it("finds a record by its slug", async () => {
    const vendor = await newVendor();
    expect(await repos.vendors.getBySlug(vendor.slug)).toEqual(vendor);
    expect(await repos.vendors.getBySlug("no-such-vendor")).toBeUndefined();
  });

  it("finds a record by its key on a table with no slug", async () => {
    const key = unique("capability");
    const capability = await repos.capabilities.create({ key, name: `Capability ${key}` }, editor);
    expect(await repos.capabilities.getBySlug(key)).toEqual(capability);
  });

  it("lists records in name order", async () => {
    const suffix = unique("order");
    const created = await Promise.all(
      ["Zulu", "Alpha", "Mike"].map((name) =>
        repos.ownershipLevels.create(
          { key: `${name.toLowerCase()}-${suffix}`, name: `${name} ${suffix}` },
          editor,
        ),
      ),
    );
    const ids = new Set(created.map((level) => level.id));
    const listed = (await repos.ownershipLevels.list()).filter((level) => ids.has(level.id));
    expect(listed.map((level) => level.name)).toEqual([
      `Alpha ${suffix}`,
      `Mike ${suffix}`,
      `Zulu ${suffix}`,
    ]);
  });

  it("lists a page of records when given a limit and offset", async () => {
    await newVendor();
    await newVendor();
    await newVendor();
    const all = await repos.vendors.list();
    expect(await repos.vendors.list({ limit: 2 })).toEqual(all.slice(0, 2));
    expect(await repos.vendors.list({ limit: 1, offset: 1 })).toEqual(all.slice(1, 2));
  });

  it("refuses a limit or offset that is not a whole number", async () => {
    await expect(repos.vendors.list({ limit: 0 })).rejects.toThrow(RangeError);
    await expect(repos.vendors.list({ limit: 1.5 })).rejects.toThrow(RangeError);
    await expect(repos.vendors.list({ offset: -1 })).rejects.toThrow(RangeError);
  });
});

describe("a transaction", () => {
  it("keeps every change made in it when it succeeds", async () => {
    const slug = unique("vendor");
    const tool = await repos.transaction(async (tx) => {
      const vendor = await tx.vendors.create({ slug, name: `Vendor ${slug}` }, editor);
      const key = unique("tool");
      return tx.tools.create({ key, slug: key, name: "Tool", vendorId: vendor.id }, editor);
    });
    const vendor = await repos.vendors.getBySlug(slug);
    expect(vendor).toBeDefined();
    expect(tool.vendorId).toBe(vendor?.id);
    expect(await auditEntriesFor("tool", tool.id)).toHaveLength(1);
  });

  it("rolls back every change made in it, and their audit entries, when it fails", async () => {
    const slug = unique("vendor");
    let vendorId: number | undefined;
    await expect(
      repos.transaction(async (tx) => {
        const vendor = await tx.vendors.create({ slug, name: `Vendor ${slug}` }, editor);
        vendorId = vendor.id;
        await tx.vendors.update(vendor.id, { description: "Changed" }, editor);
        throw new Error("something went wrong after the writes");
      }),
    ).rejects.toThrow("something went wrong after the writes");
    expect(vendorId).toBeDefined();
    expect(await repos.vendors.getBySlug(slug)).toBeUndefined();
    expect(await auditEntriesFor("vendor", vendorId ?? MISSING_ID)).toEqual([]);
  });

  it("rolls back earlier changes when a later audit insert fails", async () => {
    const slug = unique("vendor");
    await expect(
      repos.transaction(async (tx) => {
        const vendor = await tx.vendors.create({ slug, name: `Vendor ${slug}` }, editor);
        const key = unique("tool");
        await tx.tools.create({ key, slug: key, name: "Tool", vendorId: vendor.id }, editor, {
          changeSummary: REJECTED_SUMMARY,
        });
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
    expect(await repos.vendors.getBySlug(slug)).toBeUndefined();
  });

  it("lets a caller recover from a failed write and carry on", async () => {
    const existing = await newVendor();
    const slug = unique("vendor");
    await repos.transaction(async (tx) => {
      await expect(
        tx.vendors.create({ slug: existing.slug, name: unique("Vendor") }, editor),
      ).rejects.toMatchObject({ kind: "duplicate" });
      await tx.vendors.create({ slug, name: `Vendor ${slug}` }, editor);
    });
    expect(await repos.vendors.getBySlug(slug)).toBeDefined();
  });
});
