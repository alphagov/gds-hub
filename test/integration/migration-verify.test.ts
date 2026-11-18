import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  capabilities,
  capabilityTools,
  pages,
  redirects,
  tools,
} from "../../src/db/schema/index.js";
import { silentLogger } from "../../src/lib/logger.js";
import { buildMigrationPlan, type MigrationPlan } from "../../src/migration/inventory.js";
import { newRunId } from "../../src/migration/load-report.js";
import { loadPlan } from "../../src/migration/loader.js";
import { verifyMigration, type VerifyOutcome } from "../../src/migration/verify.js";
import { connectRepositories, type RepositoryConnection } from "../../src/repositories/index.js";
import { createActor } from "../../src/services/audit/actor.js";
import { testConfig } from "../unit/helpers.js";
import { fixtureOptions, fixtureSources } from "../unit/migration/helpers.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// The tests share one database and run in order. The first checks the
// migration as loaded. Each later one changes the database the way a mistake
// or an editor might, and checks verify notices; earlier changes stay.

const EDITOR = createActor({ email: "editor@example.com" });
const CHANGED_DESCRIPTION = "An invented description an editor typed";

let testDb: TestDatabase;
let connection: RepositoryConnection;
let plan: MigrationPlan;

beforeAll(async () => {
  testDb = await createMigratedTestDatabase();
  connection = connectRepositories(testDb.url);
  plan = await buildMigrationPlan(fixtureSources(), fixtureOptions());
  await loadPlan(plan, connection.repositories, { apply: true, runId: newRunId(new Date()) });
});

afterAll(async () => {
  await connection.close();
  await testDb.drop();
});

function verify(): Promise<VerifyOutcome> {
  return verifyMigration({
    plan,
    sources: fixtureSources(),
    contentSelector: fixtureOptions().contentSelector,
    repositories: connection.repositories,
    config: { ...testConfig, databaseUrl: testDb.url },
    logger: silentLogger,
  });
}

async function idWhere(rows: PromiseLike<{ id: number }[]>, what: string): Promise<number> {
  const [row] = await rows;
  if (row === undefined) throw new Error(`no ${what}`);
  return row.id;
}

describe("verifying a migration", () => {
  it("passes when the database and the new pages match the plan", async () => {
    const outcome = await verify();
    expect(outcome.problems).toEqual([]);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.passed).toBe(true);
    expect(outcome.checked).toEqual({ records: 52, pages: 10, redirects: 28 });
  });

  it("lists redirects to content pages as waiting for their routes, not as problems", async () => {
    const outcome = await verify();
    expect(outcome.waitingForPhase6).toEqual(
      expect.arrayContaining(["/policies/device-policy", "/guidance/widgets", "/pages/about"]),
    );
    expect(outcome.waitingForPhase6).not.toContain("/tools/lanternly");
  });

  it("writes nothing", async () => {
    const entries = await testDb.db.$count(auditLog);
    await verify();
    expect(await testDb.db.$count(auditLog)).toBe(entries);
  });

  it("finds a value that differs from the plan, naming the field but not the value", async () => {
    const lanternly = await idWhere(
      testDb.db.select({ id: tools.id }).from(tools).where(eq(tools.key, "lanternly")),
      "lanternly tool",
    );
    await connection.repositories.tools.update(
      lanternly,
      { description: CHANGED_DESCRIPTION },
      EDITOR,
    );

    const outcome = await verify();

    expect(outcome.passed).toBe(false);
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({
        code: "different_value",
        entity: "tool",
        key: "lanternly",
        field: "description",
      }),
    );
    expect(JSON.stringify(outcome)).not.toContain(CHANGED_DESCRIPTION);
  });

  it("finds a missing link between records", async () => {
    const noteTaking = await idWhere(
      testDb.db
        .select({ id: capabilities.id })
        .from(capabilities)
        .where(eq(capabilities.key, "note-taking")),
      "note-taking capability",
    );
    const kettleBoard = await idWhere(
      testDb.db.select({ id: tools.id }).from(tools).where(eq(tools.key, "kettle-board")),
      "kettle-board tool",
    );
    const link = await idWhere(
      testDb.db
        .select({ id: capabilityTools.id })
        .from(capabilityTools)
        .where(
          and(
            eq(capabilityTools.capabilityId, noteTaking),
            eq(capabilityTools.toolId, kettleBoard),
          ),
        ),
      "capability tool link",
    );
    await connection.repositories.capabilityTools.remove(link, EDITOR);

    const outcome = await verify();

    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ code: "missing_link", entity: "capability", key: "note-taking" }),
    );
  });

  it("finds a missing redirect", async () => {
    const redirect = await idWhere(
      testDb.db
        .select({ id: redirects.id })
        .from(redirects)
        .where(eq(redirects.oldPath, "/old-widgets.html")),
      "redirect",
    );
    await connection.repositories.redirects.remove(redirect, EDITOR);

    const outcome = await verify();

    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ code: "redirect_missing", path: "/old-widgets.html" }),
    );
  });

  it("finds a missing record, and the redirects that now lead nowhere", async () => {
    const about = await idWhere(
      testDb.db.select({ id: pages.id }).from(pages).where(eq(pages.slug, "about")),
      "about page",
    );
    await connection.repositories.pages.remove(about, EDITOR);

    const outcome = await verify();

    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ code: "missing_record", entity: "page", key: "about" }),
    );
    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ code: "redirect_target_missing", path: "/about.html" }),
    );
  });

  it("finds a redirect hidden by a new page at the same address", async () => {
    // Express ignores the trailing slash, so /tools/lantern-notes-wiki/ (the
    // tool's old address) now reaches this tool's page instead of redirecting.
    await connection.repositories.tools.create(
      { key: "lantern-notes-wiki", slug: "lantern-notes-wiki", name: "A different tool" },
      EDITOR,
    );

    const outcome = await verify();

    expect(outcome.problems).toContainEqual(
      expect.objectContaining({ code: "redirect_shadowed", path: "/tools/lantern-notes-wiki/" }),
    );
    expect(outcome.warnings).toContainEqual(
      expect.objectContaining({
        code: "only_in_database",
        entity: "tool",
        key: "lantern-notes-wiki",
      }),
    );
  });
});
