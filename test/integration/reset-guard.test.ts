import { setTimeout as sleep } from "node:timers/promises";
import { eq, sql, type SQL } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { dropAppObjects, UnsafeDatabaseOperationError } from "../../src/db/reset.js";
import { auditLog, tools } from "../../src/db/schema/index.js";
import { seedDatabase } from "../../src/db/seed/seed.js";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

// Each test starts with a new, empty database.
let testDatabase: TestDatabase | undefined;
const current = (): TestDatabase => {
  if (!testDatabase) throw new Error("test database was not created");
  return testDatabase;
};
const db = () => current().db;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
});

afterEach(async () => {
  await testDatabase?.drop();
  testDatabase = undefined;
});

async function migrateAndSeed(): Promise<void> {
  await runMigrations(db());
  await seedDatabase(db());
}

const IMPORT_ENTRY: typeof auditLog.$inferInsert = {
  entityType: "tool",
  entityId: 1,
  action: "create",
  after: { name: "Imported" },
  actorName: "system:data_migration",
  actorSubject: "system:data_migration",
};

const importEntries = () =>
  db().$count(auditLog, eq(auditLog.actorSubject, "system:data_migration"));

/** Everything in the public schema, plus the migration history schema if it exists. */
async function objectsLeft(): Promise<string[]> {
  const result = await db().execute<{ object: string }>(sql`
    SELECT 'relation ' || relname AS object FROM pg_catalog.pg_class
      WHERE relnamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'function ' || proname FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'type ' || typname FROM pg_catalog.pg_type
      WHERE typnamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'schema ' || nspname FROM pg_catalog.pg_namespace WHERE nspname = 'drizzle'
    ORDER BY object`);
  return result.rows.map((row) => row.object);
}

/** Waits until a query in the test database is blocked, waiting for a lock. */
async function waitForAQueryWaitingOnALock(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await db().execute<{ waiting: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      ) AS waiting`);
    if (result.rows[0]?.waiting) return;
    await sleep(50);
  }
  throw new Error("no query waited for a lock");
}

describe("db:reset", () => {
  it("is allowed on an empty database", async () => {
    await expect(dropAppObjects(db())).resolves.toBeUndefined();
    expect(await objectsLeft()).toEqual([]);
  });

  it("drops everything the migrations create", async () => {
    await runMigrations(db());
    await expect(dropAppObjects(db())).resolves.toBeUndefined();
    expect(await objectsLeft()).toEqual([]);
  });

  it("is allowed on a seeded development database, including audited edits made in it", async () => {
    await migrateAndSeed();
    const [created] = await db()
      .insert(tools)
      .values({ key: "new-tool", slug: "new-tool", name: "New tool" })
      .returning({ id: tools.id });
    if (!created) throw new Error("expected the new tool to be inserted");
    await db()
      .insert(auditLog)
      .values([
        {
          entityType: "tool",
          entityId: created.id,
          action: "create",
          after: { name: "New tool" },
          actorName: "editor@example.com",
          actorSubject: "editor@example.com",
        },
        {
          entityType: "tool",
          entityId: 1,
          action: "update",
          before: { name: "Old" },
          after: { name: "New" },
          actorName: "editor@example.com",
          actorSubject: "editor@example.com",
        },
      ]);

    await expect(dropAppObjects(db())).resolves.toBeUndefined();
    expect(await objectsLeft()).toEqual([]);
  });

  it("is refused when a seeded database has rows with no audit record of being created, and keeps them", async () => {
    await migrateAndSeed();
    await db()
      .insert(tools)
      .values({ key: "unrecorded-tool", slug: "unrecorded-tool", name: "Unrecorded tool" });

    await expect(dropAppObjects(db())).rejects.toThrow(
      /rows that have no audit record of being created \(in tools\)/,
    );
    expect(await db().$count(tools, eq(tools.key, "unrecorded-tool"))).toBe(1);
  });

  it("keeps functions and sequences this app doesn't create", async () => {
    await db().execute(sql`CREATE SEQUENCE other_app_ids`);
    await db().execute(sql`CREATE FUNCTION other_app_answer() RETURNS integer
      LANGUAGE sql AS 'SELECT 42'`);
    await migrateAndSeed();

    await expect(dropAppObjects(db())).resolves.toBeUndefined();
    expect(await objectsLeft()).toEqual(["function other_app_answer", "relation other_app_ids"]);
  });

  it("is refused when the database has tables this app doesn't create, and keeps them", async () => {
    await db().execute(sql`CREATE TABLE other_app_records (id integer)`);
    await db().execute(sql`INSERT INTO other_app_records VALUES (1)`);

    await expect(dropAppObjects(db())).rejects.toThrow(
      /tables this app doesn't create \(public\.other_app_records\)/,
    );
    expect(await db().$count(sql`other_app_records`)).toBe(1);
  });

  it("is refused when the migration history schema has tables this app doesn't create, and keeps them", async () => {
    await db().execute(sql`CREATE SCHEMA drizzle`);
    await db().execute(sql`CREATE TABLE drizzle.other_app_records (id integer)`);
    await db().execute(sql`INSERT INTO drizzle.other_app_records VALUES (1)`);

    await expect(dropAppObjects(db())).rejects.toThrow(
      /tables this app doesn't create \(drizzle\.other_app_records\)/,
    );
    expect(await db().$count(sql`drizzle.other_app_records`)).toBe(1);
  });

  it.each<{ dependent: string; create: readonly SQL[]; dependentRows: SQL }>([
    {
      dependent: "a view in another schema reads an app table",
      create: [
        sql`CREATE SCHEMA reporting`,
        sql`CREATE VIEW reporting.tool_names AS SELECT name FROM public.tools`,
      ],
      dependentRows: sql`reporting.tool_names`,
    },
    {
      dependent: "a table in another schema has a column of an app enum",
      create: [
        sql`CREATE SCHEMA reporting`,
        sql`CREATE TABLE reporting.page_states (status public.content_status)`,
        sql`INSERT INTO reporting.page_states VALUES ('draft')`,
      ],
      dependentRows: sql`reporting.page_states`,
    },
  ])("is refused when $dependent, and drops nothing", async ({ create, dependentRows }) => {
    await migrateAndSeed();
    for (const statement of create) await db().execute(statement);

    await expect(dropAppObjects(db())).rejects.toThrow(
      /other objects depend on what this app creates/,
    );
    expect(await db().$count(dependentRows)).toBeGreaterThan(0);
    expect(await db().$count(tools)).toBeGreaterThan(0);
  });

  it("is refused once the database has imported data, and keeps it", async () => {
    await migrateAndSeed();
    await db().insert(auditLog).values(IMPORT_ENTRY);

    await expect(dropAppObjects(db())).rejects.toThrow(UnsafeDatabaseOperationError);
    await expect(dropAppObjects(db())).rejects.toThrow(/imported data/);
    expect(await importEntries()).toBe(1);
  });

  it(
    "waits for an import in progress to finish, then refuses to drop its data",
    { timeout: 20_000 },
    async () => {
      await migrateAndSeed();
      const importer = new pg.Client({ connectionString: current().url });
      await importer.connect();
      try {
        await importer.query("BEGIN");
        await importer.query(
          `INSERT INTO audit_log (entity_type, entity_id, action, after, actor_name, actor_subject)
           VALUES ('tool', 1, 'create', '{"name": "Imported"}', 'system:data_migration', 'system:data_migration')`,
        );

        // The reset can't lock audit_log until the import commits.
        const outcome = dropAppObjects(db()).then(
          () => "dropped",
          (error: unknown) => error,
        );
        await waitForAQueryWaitingOnALock();
        await importer.query("COMMIT");

        const error = await outcome;
        expect(error).toBeInstanceOf(UnsafeDatabaseOperationError);
        expect(error).toHaveProperty("message", expect.stringMatching(/imported data/));
      } finally {
        await importer.end();
      }
      expect(await importEntries()).toBe(1);
    },
  );

  it("is refused when there is data the seed didn't create, and keeps it", async () => {
    await runMigrations(db());
    await db().insert(tools).values({ key: "real-tool", slug: "real-tool", name: "Real tool" });

    await expect(dropAppObjects(db())).rejects.toThrow(
      /data that wasn't created by the seed \(in tools\)/,
    );
    expect(await db().$count(tools)).toBe(1);
  });

  it("is allowed on a seeded database migrated before a newer table was added", async () => {
    // Stands in for a database migrated before the redirects table existed.
    await migrateAndSeed();
    await db().execute(sql`DROP TABLE redirects`);

    await expect(dropAppObjects(db())).resolves.toBeUndefined();
    expect(await objectsLeft()).toEqual([]);
  });

  it("is still refused on an older database with data the seed didn't create", async () => {
    await runMigrations(db());
    await db().execute(sql`DROP TABLE redirects`);
    await db().insert(tools).values({ key: "real-tool", slug: "real-tool", name: "Real tool" });

    await expect(dropAppObjects(db())).rejects.toThrow(
      /data that wasn't created by the seed \(in tools\)/,
    );
    expect(await db().$count(tools)).toBe(1);
  });

  it("is refused when the database has no audit_log table", async () => {
    await runMigrations(db());
    await db().execute(sql`DROP TABLE audit_log`);

    await expect(dropAppObjects(db())).rejects.toThrow(/without an audit_log table/);
  });
});
