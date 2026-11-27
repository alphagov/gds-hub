import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vendors } from "../../src/db/schema/index.js";
import {
  createRepositories,
  RepositoryError,
  type Repositories,
} from "../../src/repositories/index.js";
import { createActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// A repository update can say which version of the record the editor saw.

const editor = createActor({ email: "editor@example.com" });
const otherEditor = createActor({ email: "other.editor@example.com" });

let testDatabase: TestDatabase | undefined;
let repos: Repositories;

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  repos = createRepositories(created.db);
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("an update that says when the record was last changed", () => {
  it("goes ahead when the record hasn't changed since", async () => {
    const vendor = await repos.vendors.create({ slug: "a", name: "A" }, editor);

    const { record } = await repos.vendors.update(vendor.id, { description: "New" }, editor, {
      expectedUpdatedAt: vendor.updatedAt,
    });

    expect(record.description).toBe("New");
  });

  it("is refused as stale when the record has changed since, and writes nothing", async () => {
    const vendor = await repos.vendors.create({ slug: "b", name: "B" }, editor);
    await repos.vendors.update(vendor.id, { description: "First" }, editor);

    const attempt = repos.vendors.update(vendor.id, { description: "Second" }, editor, {
      expectedUpdatedAt: vendor.updatedAt,
    });

    await expect(attempt).rejects.toMatchObject({ kind: "stale" });
    await expect(attempt).rejects.toBeInstanceOf(RepositoryError);
    expect((await repos.vendors.getById(vendor.id))?.description).toBe("First");
  });

  it("is still refused as stale when nothing would change", async () => {
    const vendor = await repos.vendors.create({ slug: "c", name: "C" }, editor);
    await repos.vendors.update(vendor.id, { description: "First" }, editor);

    await expect(
      repos.vendors.update(vendor.id, { description: "First" }, editor, {
        expectedUpdatedAt: vendor.updatedAt,
      }),
    ).rejects.toMatchObject({ kind: "stale" });
  });

  it("always moves the update time on, even when the database clock hasn't", async () => {
    const vendor = await repos.vendors.create({ slug: "e", name: "E" }, editor);
    // As if the last write happened in the same millisecond as the next one.
    const ahead = new Date(Date.now() + 3_600_000);
    await testDatabase?.db
      .update(vendors)
      .set({ updatedAt: ahead })
      .where(eq(vendors.id, vendor.id));

    const { record } = await repos.vendors.update(vendor.id, { description: "Next" }, editor, {
      expectedUpdatedAt: ahead,
    });

    expect(record.updatedAt.getTime()).toBe(ahead.getTime() + 1);
    await expect(
      repos.vendors.update(vendor.id, { description: "Late" }, editor, {
        expectedUpdatedAt: ahead,
      }),
    ).rejects.toMatchObject({ kind: "stale" });
  });

  it("is not checked when no time is given, as before", async () => {
    const vendor = await repos.vendors.create({ slug: "d", name: "D" }, editor);
    await repos.vendors.update(vendor.id, { description: "First" }, editor);

    const { record } = await repos.vendors.update(vendor.id, { description: "Second" }, editor);

    expect(record.description).toBe("Second");
  });
});

describe("a removal that says when the record was last changed", () => {
  it("goes ahead when the record hasn't changed since", async () => {
    const vendor = await repos.vendors.create({ slug: "r1", name: "R1" }, editor);

    await repos.vendors.remove(vendor.id, editor, { expectedUpdatedAt: vendor.updatedAt });

    expect(await repos.vendors.getById(vendor.id)).toBeUndefined();
  });

  it("is refused as stale when the record has changed since, and deletes nothing", async () => {
    const vendor = await repos.vendors.create({ slug: "r2", name: "R2" }, editor);
    await repos.vendors.update(vendor.id, { description: "Newer" }, editor);

    await expect(
      repos.vendors.remove(vendor.id, editor, { expectedUpdatedAt: vendor.updatedAt }),
    ).rejects.toMatchObject({ kind: "stale" });
    expect((await repos.vendors.getById(vendor.id))?.description).toBe("Newer");
  });

  it("audits the deletion after the update before it, even when the database clock is behind", async () => {
    const vendor = await repos.vendors.create({ slug: "r3", name: "R3" }, editor);
    const ahead = new Date(Date.now() + 3_600_000);
    await testDatabase?.db
      .update(vendors)
      .set({ updatedAt: ahead })
      .where(eq(vendors.id, vendor.id));
    await repos.vendors.update(vendor.id, { description: "Latest" }, editor);

    await repos.vendors.remove(vendor.id, editor);

    const entries = await repos.auditLog.historyFor("vendor", vendor.id, 10);
    expect(entries.map((entry) => entry.action)).toEqual(["delete", "update", "create"]);
  });
});

describe("a write that says who last changed the record", () => {
  it("is refused as stale when someone else has changed it since", async () => {
    const vendor = await repos.vendors.create({ slug: "a1", name: "A1" }, editor);
    await repos.vendors.update(vendor.id, { description: "By someone else" }, otherEditor);

    await expect(
      repos.vendors.update(vendor.id, { description: "Overwritten" }, editor, {
        expectedLastActor: editor.email,
      }),
    ).rejects.toMatchObject({ kind: "stale" });
    await expect(
      repos.vendors.remove(vendor.id, editor, { expectedLastActor: editor.email }),
    ).rejects.toMatchObject({ kind: "stale" });
    expect((await repos.vendors.getById(vendor.id))?.description).toBe("By someone else");
  });

  it("goes ahead when that person was the last to change it", async () => {
    const vendor = await repos.vendors.create({ slug: "a2", name: "A2" }, editor);

    await repos.vendors.update(vendor.id, { description: "Mine" }, editor, {
      expectedLastActor: editor.email,
    });

    expect((await repos.vendors.getById(vendor.id))?.description).toBe("Mine");
  });
});
