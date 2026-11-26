import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { auditLog } from "../../src/db/schema/index.js";
import { TEST_MODE_ACTOR_EMAIL } from "../../src/editing/test-mode.js";
import {
  createRepositories,
  RepositoryError,
  type Repositories,
} from "../../src/repositories/index.js";
import { createActor, systemActor } from "../../src/services/audit/actor.js";
import { createEditService, type EditService } from "../../src/services/editing/edit-service.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// The edit service against a real database: every write is audited with the
// actor it was given, and a stale or in-use change is refused without writing.

const testModeActor = systemActor("unauthenticated_test_mode");
const person = createActor({ email: "someone@example.com" });

let testDatabase: TestDatabase | undefined;
let db: Database;
let repos: Repositories;
let service: EditService;

async function auditFor(entityType: string, entityId: number) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  return rows.filter((row) => row.entityType === entityType);
}

async function rejection(work: Promise<unknown>): Promise<RepositoryError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof RepositoryError) return error;
    throw error;
  }
  throw new Error("expected the change to be refused");
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  db = created.db;
  repos = createRepositories(created.db);
  service = createEditService(repos);
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the test mode actor", () => {
  it("is a system actor the audit log accepts, and is not an editor's email", () => {
    expect(testModeActor.email).toBe(TEST_MODE_ACTOR_EMAIL);
    expect(TEST_MODE_ACTOR_EMAIL.startsWith("system:")).toBe(true);
    expect(() => createActor({ email: TEST_MODE_ACTOR_EMAIL })).toThrow();
  });
});

describe("creating", () => {
  it("writes the record and a create audit entry naming the test mode actor", async () => {
    const created = await service.create(
      "vendors",
      {
        slug: "compass-co",
        name: "Compass Co",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
    );

    expect(created.title).toBe("Compass Co");
    const [entry] = await auditFor("vendor", created.id);
    expect(entry).toMatchObject({
      action: "create",
      actorName: TEST_MODE_ACTOR_EMAIL,
      actorSubject: TEST_MODE_ACTOR_EMAIL,
    });
  });

  it("records whichever actor it is given, so a verified editor can replace test mode", async () => {
    const created = await service.create(
      "vendors",
      {
        slug: "verified-co",
        name: "Verified Co",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      person,
    );

    const [entry] = await auditFor("vendor", created.id);
    expect(entry?.actorSubject).toBe("someone@example.com");
  });

  it("sets a tool's key from the values it is given and links a vendor", async () => {
    const vendor = (await service.list("vendors")).find((record) => record.title === "Compass Co");
    const created = await service.create(
      "tools",
      {
        key: "atlas-maker",
        slug: "atlas-maker",
        name: "Atlas Maker",
        description: null,
        engineeringOrBusinessTool: null,
        vendorId: vendor?.id ?? null,
      },
      testModeActor,
    );

    const found = await service.find("tools", created.id);
    expect(found?.values).toMatchObject({
      slug: "atlas-maker",
      name: "Atlas Maker",
      vendorId: vendor?.id,
    });
  });

  it("refuses a link to a record that doesn't exist", async () => {
    const error = await rejection(
      service.create(
        "tools",
        {
          key: "ghost",
          slug: "ghost",
          name: "Ghost",
          description: null,
          engineeringOrBusinessTool: null,
          vendorId: 999_999,
        },
        testModeActor,
      ),
    );

    expect(error.kind).toBe("invalid_reference");
  });

  it("refuses a duplicate slug", async () => {
    const error = await rejection(
      service.create(
        "vendors",
        {
          slug: "compass-co",
          name: "Another",
          description: null,
          url: null,
          supportContact: null,
          dataProtectionContact: null,
        },
        testModeActor,
      ),
    );

    expect(error.kind).toBe("duplicate");
  });
});

describe("reading", () => {
  it("lists records of a kind by title, with when each was last changed", async () => {
    const records = await service.list("vendors");

    expect(records.map((record) => record.title)).toEqual([...records.map((r) => r.title)].sort());
    expect(records[0]?.updatedAt).toBeInstanceOf(Date);
  });

  it("finds a record's values under the form's field names", async () => {
    const [vendor] = await service.list("vendors");
    const found = await service.find("vendors", vendor?.id ?? 0);

    expect(found?.values).toHaveProperty("slug");
    expect(found?.values).toHaveProperty("name");
    expect(found?.title).toBe(vendor?.title);
  });

  it("finds nothing for an id that isn't there", async () => {
    expect(await service.find("vendors", 999_999)).toBeUndefined();
  });

  it("offers the records a select can link to, in name order", async () => {
    const choices = await service.choices("tools");

    expect(choices.vendorId?.map((choice) => choice.text)).toEqual(
      [...(choices.vendorId ?? []).map((choice) => choice.text)].sort(),
    );
    expect(choices.vendorId?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("updating", () => {
  it("changes the record and audits it with the actor", async () => {
    const created = await service.create(
      "vendors",
      {
        slug: "change-me",
        name: "Change me",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
    );

    const updated = await service.update(
      "vendors",
      created.id,
      {
        name: "Changed",
        description: "New text",
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
      created.updatedAt,
    );

    expect(updated.title).toBe("Changed");
    const entries = await auditFor("vendor", created.id);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["create", "update"]);
  });

  it("refuses a change made from an out-of-date form, and writes nothing", async () => {
    const created = await service.create(
      "vendors",
      {
        slug: "race-me",
        name: "Race me",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
    );
    const loadedAt = created.updatedAt;
    await service.update(
      "vendors",
      created.id,
      {
        name: "First editor",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
      loadedAt,
    );

    const error = await rejection(
      service.update(
        "vendors",
        created.id,
        {
          name: "Second editor",
          description: null,
          url: null,
          supportContact: null,
          dataProtectionContact: null,
        },
        testModeActor,
        loadedAt,
      ),
    );

    expect(error.kind).toBe("stale");
    expect((await service.find("vendors", created.id))?.title).toBe("First editor");
    expect(await auditFor("vendor", created.id)).toHaveLength(2);
  });

  it("refuses a change to a record that has gone", async () => {
    const error = await rejection(
      service.update(
        "vendors",
        999_999,
        {
          name: "x",
          description: null,
          url: null,
          supportContact: null,
          dataProtectionContact: null,
        },
        testModeActor,
        new Date(),
      ),
    );

    expect(error.kind).toBe("not_found");
  });
});

describe("publishing a page", () => {
  const page = (status: string, title: string) => ({
    slug: "publish-me",
    title,
    pageType: "guidance",
    summary: null,
    bodyMarkdown: "Text",
    ownerName: null,
    ownerContact: null,
    productTeamServiceId: null,
    status,
    lastReviewedAt: null,
  });

  it("sets the published time when the status first becomes published, and keeps it", async () => {
    const draft = await service.create("pages", page("draft", "Draft"), testModeActor);
    expect((await repos.pages.getById(draft.id))?.publishedAt).toBeNull();

    const published = await service.update(
      "pages",
      draft.id,
      page("published", "Draft"),
      testModeActor,
      draft.updatedAt,
    );
    const first = (await repos.pages.getById(draft.id))?.publishedAt;
    expect(first).toBeInstanceOf(Date);

    await service.update(
      "pages",
      draft.id,
      page("published", "Renamed"),
      testModeActor,
      published.updatedAt,
    );
    expect((await repos.pages.getById(draft.id))?.publishedAt).toEqual(first);
  });
});

describe("removing", () => {
  it("deletes the record and audits it with the actor", async () => {
    const created = await service.create(
      "vendors",
      {
        slug: "delete-me",
        name: "Delete me",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
    );

    await service.remove("vendors", created.id, testModeActor, created.updatedAt);

    expect(await service.find("vendors", created.id)).toBeUndefined();
    const entries = await auditFor("vendor", created.id);
    expect(entries.map((entry) => entry.action).sort()).toEqual(["create", "delete"]);
    expect(entries.every((entry) => entry.actorSubject === TEST_MODE_ACTOR_EMAIL)).toBe(true);
  });

  it("refuses to delete a record that something still uses, and leaves it", async () => {
    const vendor = (await service.list("vendors")).find((record) => record.title === "Compass Co");

    const error = await rejection(
      service.remove("vendors", vendor?.id ?? 0, testModeActor, vendor?.updatedAt ?? new Date(0)),
    );

    expect(error.kind).toBe("in_use");
    expect(await service.find("vendors", vendor?.id ?? 0)).toBeDefined();
  });

  it("refuses to delete a version that has changed since the editor confirmed, and leaves it", async () => {
    const created = await service.create(
      "vendors",
      {
        slug: "changed-meanwhile",
        name: "Changed meanwhile",
        description: null,
        url: null,
        supportContact: null,
        dataProtectionContact: null,
      },
      testModeActor,
    );
    await service.update(
      "vendors",
      created.id,
      { name: "Changed by someone else" },
      testModeActor,
      created.updatedAt,
    );

    const error = await rejection(
      service.remove("vendors", created.id, testModeActor, created.updatedAt),
    );

    expect(error.kind).toBe("stale");
    expect((await service.find("vendors", created.id))?.title).toBe("Changed by someone else");
  });
});
