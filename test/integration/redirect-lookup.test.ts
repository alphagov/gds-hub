import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectRepositories, type RepositoryConnection } from "../../src/repositories/index.js";
import { createActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

const EDITOR = createActor({ email: "editor@example.com" });

let testDb: TestDatabase;
let connection: RepositoryConnection;

beforeAll(async () => {
  testDb = await createMigratedTestDatabase();
  connection = connectRepositories(testDb.url);
  const { redirects } = connection.repositories;
  await redirects.create({ oldPath: "/tools/old-name/", newPath: "/tools/new-name" }, EDITOR);
  await redirects.create({ oldPath: "/about.html", newPath: "/pages/about" }, EDITOR);
});

afterAll(async () => {
  await connection.close();
  await testDb.drop();
});

describe("looking up redirects", () => {
  it("gives the new path of each old path that has a redirect", async () => {
    const found = await connection.repositories.redirectLookup.newPathsFor([
      "/tools/old-name/",
      "/tools/old-name",
      "/about.html",
    ]);
    expect(Object.fromEntries(found)).toEqual({
      "/tools/old-name/": "/tools/new-name",
      "/about.html": "/pages/about",
    });
  });

  it("matches old paths exactly, including their letter case", async () => {
    const found = await connection.repositories.redirectLookup.newPathsFor(["/About.html"]);
    expect(found.size).toBe(0);
  });

  it("gives nothing for no paths", async () => {
    expect((await connection.repositories.redirectLookup.newPathsFor([])).size).toBe(0);
  });

  it("records each redirect's creation in the audit log", async () => {
    const changes = await connection.repositories.auditLog.recent(10, ["redirect"]);
    expect(changes).toHaveLength(2);
    expect(changes.every((change) => change.actorSubject === "editor@example.com")).toBe(true);
  });
});
