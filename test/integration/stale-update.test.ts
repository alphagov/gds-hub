import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRepositories,
  RepositoryError,
  type Repositories,
} from "../../src/repositories/index.js";
import { createActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// A repository update can say which version of the record the editor saw.

const editor = createActor({ email: "editor@example.com" });

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

  it("is not checked when no time is given, as before", async () => {
    const vendor = await repos.vendors.create({ slug: "d", name: "D" }, editor);
    await repos.vendors.update(vendor.id, { description: "First" }, editor);

    const { record } = await repos.vendors.update(vendor.id, { description: "Second" }, editor);

    expect(record.description).toBe("Second");
  });
});
