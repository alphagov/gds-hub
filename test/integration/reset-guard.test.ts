import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { assertResettable, UnsafeDatabaseOperationError } from "../../src/db/reset.js";
import { auditLog, tools } from "../../src/db/schema/index.js";
import { seedDatabase } from "../../src/db/seed/seed.js";
import {
  createMigratedTestDatabase,
  createTestDatabase,
  type TestDatabase,
} from "./test-database.js";

// The tests in each describe block share a database and run in order: each
// one moves the database on to the next state.

describe("db:reset on a database that starts empty", () => {
  let testDatabase: TestDatabase | undefined;
  const db = () => {
    if (!testDatabase) throw new Error("test database was not created");
    return testDatabase.db;
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase?.drop();
  });

  it("is allowed when the database has no tables", async () => {
    await expect(assertResettable(db())).resolves.toBeUndefined();
  });

  it("is refused when the database has tables this app doesn't create", async () => {
    await db().execute(sql`CREATE TABLE other_app_records (id integer)`);
    try {
      await expect(assertResettable(db())).rejects.toThrow(
        /tables this app doesn't create \(other_app_records\)/,
      );
    } finally {
      await db().execute(sql`DROP TABLE other_app_records`);
    }
  });

  it("is allowed when the database is migrated but has no data", async () => {
    await runMigrations(db());
    await expect(assertResettable(db())).resolves.toBeUndefined();
  });

  it("is allowed on a seeded development database, including edits made in it", async () => {
    await seedDatabase(db());
    await db()
      .insert(auditLog)
      .values({
        entityType: "tool",
        entityId: 1,
        action: "update",
        before: { name: "Old" },
        after: { name: "New" },
        actorName: "editor@example.com",
        actorSubject: "editor@example.com",
      });
    await expect(assertResettable(db())).resolves.toBeUndefined();
  });

  it("is refused once the database has imported data", async () => {
    await db()
      .insert(auditLog)
      .values({
        entityType: "tool",
        entityId: 1,
        action: "create",
        after: { name: "Imported" },
        actorName: "Hub import",
        actorSubject: "system:import",
      });
    await expect(assertResettable(db())).rejects.toThrow(UnsafeDatabaseOperationError);
    await expect(assertResettable(db())).rejects.toThrow(/imported data/);
  });
});

describe("db:reset on a migrated database with data from elsewhere", () => {
  let testDatabase: TestDatabase | undefined;
  const db = () => {
    if (!testDatabase) throw new Error("test database was not created");
    return testDatabase.db;
  };

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase?.drop();
  });

  it("is refused when there is data the seed didn't create", async () => {
    await db().insert(tools).values({ key: "real-tool", slug: "real-tool", name: "Real tool" });
    await expect(assertResettable(db())).rejects.toThrow(
      /data that wasn't created by the seed \(in tools\)/,
    );
  });

  it("is refused when the database has no audit_log table", async () => {
    await db().execute(sql`DROP TABLE audit_log`);
    await expect(assertResettable(db())).rejects.toThrow(/without an audit_log table/);
  });
});
