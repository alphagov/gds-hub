import { and, desc, eq, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { ENTITY_TYPE_BY_TABLE, type AuditedTableName } from "../../src/db/entity-types.js";
import {
  auditLog,
  businessUnitProductTeamServices,
  businessUnits,
  capabilities,
  capabilityTools,
  contracts,
  instanceCapabilities,
  instances,
  ownershipLevels,
  pages,
  productTeamServiceInstances,
  productTeamServices,
  searchIndex,
  supplierTools,
  suppliers,
  tools,
  vendors,
} from "../../src/db/schema/index.js";
import { seedDatabase } from "../../src/db/seed/seed.js";
import { APP_TABLES } from "../../src/db/tables.js";
import {
  CHECK_VIOLATION,
  createMigratedTestDatabase,
  FOREIGN_KEY_VIOLATION,
  RAISE_EXCEPTION,
  postgresErrorCode,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
  type TestDatabase,
} from "./test-database.js";

// Tests in this file share one database and run in order. The seed checks come
// first, before other tests add rows of their own.

const MISSING_ID = 999_999_999;

const DATA_TABLES: readonly (readonly [AuditedTableName, PgTable])[] = [
  ["business_unit_product_team_services", businessUnitProductTeamServices],
  ["business_units", businessUnits],
  ["capabilities", capabilities],
  ["capability_tools", capabilityTools],
  ["contracts", contracts],
  ["instance_capabilities", instanceCapabilities],
  ["instances", instances],
  ["ownership_levels", ownershipLevels],
  ["pages", pages],
  ["product_team_service_instances", productTeamServiceInstances],
  ["product_team_services", productTeamServices],
  ["supplier_tools", supplierTools],
  ["suppliers", suppliers],
  ["tools", tools],
  ["vendors", vendors],
];

const SEARCHABLE_TABLES = [
  "business_units",
  "capabilities",
  "instances",
  "ownership_levels",
  "pages",
  "product_team_services",
  "tools",
  "vendors",
];

let testDatabase: TestDatabase | undefined;
let db: Database;

async function firstId(rows: PromiseLike<{ id: number }[]>): Promise<number> {
  const [row] = await rows;
  if (!row) throw new Error("expected a seeded row");
  return row.id;
}

const toolId = (key: string) =>
  firstId(db.select({ id: tools.id }).from(tools).where(eq(tools.key, key)));
const instanceId = (key: string) =>
  firstId(db.select({ id: instances.id }).from(instances).where(eq(instances.key, key)));
const capabilityId = (key: string) =>
  firstId(db.select({ id: capabilities.id }).from(capabilities).where(eq(capabilities.key, key)));
const levelId = (key: string) =>
  firstId(
    db.select({ id: ownershipLevels.id }).from(ownershipLevels).where(eq(ownershipLevels.key, key)),
  );
const businessUnitId = (key: string) =>
  firstId(
    db.select({ id: businessUnits.id }).from(businessUnits).where(eq(businessUnits.key, key)),
  );

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  db = created.db;
  await seedDatabase(db);
});

// If setup failed there's nothing to drop. Vitest reports the setup error.
afterAll(async () => {
  await testDatabase?.drop();
});

describe("a freshly migrated database", () => {
  it("has exactly the expected tables", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`);

    expect(result.rows.map((row) => row.table_name)).toEqual(
      [...DATA_TABLES.map(([name]) => name), "audit_log"].sort(),
    );
  });

  it("lists every table in APP_TABLES", async () => {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`);

    expect(APP_TABLES.map((table) => getTableName(table)).sort()).toEqual(
      result.rows.map((row) => row.table_name),
    );
  });

  it("has an audit entity type for every table except audit_log", () => {
    expect(Object.keys(ENTITY_TYPE_BY_TABLE).sort()).toEqual(
      DATA_TABLES.map(([name]) => name).sort(),
    );
  });

  it("has the enums with their values", async () => {
    const result = await db.execute<{ name: string; values: string[] }>(sql`
      SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[] AS values
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      GROUP BY t.typname ORDER BY t.typname`);

    expect(result.rows).toEqual([
      { name: "audit_action", values: ["create", "update", "delete", "publish", "unpublish"] },
      { name: "content_status", values: ["draft", "published"] },
      { name: "engineering_or_business_tool", values: ["engineering", "business"] },
      { name: "migration_status", values: ["not_started", "in_progress", "complete"] },
      {
        name: "page_type",
        values: ["policy", "service_guide", "guidance", "general", "whats_new"],
      },
    ]);
  });

  it("has no columns that could hold passwords, tokens or other credentials", async () => {
    const result = await db.execute<{ column: string }>(sql`
      SELECT table_name || '.' || column_name AS column FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name ~* '(password|passwd|secret|token|credential|api_key|private_key|salt|otp)'`);

    expect(result.rows).toEqual([]);
  });

  it("has no columns that record an IP address", async () => {
    const result = await db.execute<{ column: string }>(sql`
      SELECT table_name || '.' || column_name AS column FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ~* '(^|_)ip(_|$)|ip_address'`);

    expect(result.rows).toEqual([]);
  });

  it("has a generated, GIN-indexed search vector on every searchable table", async () => {
    const columns = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'search_vector'
        AND is_generated = 'ALWAYS' AND udt_name = 'tsvector'
      ORDER BY table_name`);
    const indexes = await db.execute<{ tablename: string }>(sql`
      SELECT tablename FROM pg_indexes
      WHERE schemaname = 'public' AND indexdef ILIKE '%USING gin (search_vector)%'
      ORDER BY tablename`);

    expect(columns.rows.map((row) => row.table_name)).toEqual(SEARCHABLE_TABLES);
    expect(indexes.rows.map((row) => row.tablename)).toEqual(SEARCHABLE_TABLES);
  });
});

describe("the seed", () => {
  it("fills every table and records a create audit entry for each row", async () => {
    for (const [name, table] of DATA_TABLES) {
      const rows = await db.$count(table);
      const audited = await db.$count(
        auditLog,
        and(eq(auditLog.entityType, ENTITY_TYPE_BY_TABLE[name]), eq(auditLog.action, "create")),
      );
      expect(rows, name).toBeGreaterThan(0);
      expect(audited, name).toBe(rows);
    }
  });

  it("refuses to run on a database that already has data", async () => {
    await expect(seedDatabase(db)).rejects.toThrow(/already has data/);
  });
});

describe("foreign keys", () => {
  it("reject a tool whose vendor does not exist", async () => {
    const code = await postgresErrorCode(() =>
      db
        .insert(tools)
        .values({ key: "orphan-tool", slug: "orphan-tool", name: "Orphan", vendorId: MISSING_ID }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("reject an instance whose tool does not exist", async () => {
    const code = await postgresErrorCode(() =>
      db
        .insert(instances)
        .values({ key: "orphan", slug: "orphan", name: "Orphan", toolId: MISSING_ID }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("reject an instance whose current or target ownership level does not exist", async () => {
    const tool = await toolId("pagewatch");
    const badCurrent = await postgresErrorCode(() =>
      db.insert(instances).values({
        key: "bad-current-level",
        slug: "bad-current-level",
        name: "Bad current level",
        toolId: tool,
        ownershipLevelId: MISSING_ID,
      }),
    );
    const badTarget = await postgresErrorCode(() =>
      db.insert(instances).values({
        key: "bad-target-level",
        slug: "bad-target-level",
        name: "Bad target level",
        toolId: tool,
        targetOwnershipLevelId: MISSING_ID,
      }),
    );
    expect(badCurrent).toBe(FOREIGN_KEY_VIOLATION);
    expect(badTarget).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("reject an instance whose contract is for a different tool", async () => {
    const contract = await firstId(
      db
        .select({ id: contracts.id })
        .from(contracts)
        .where(eq(contracts.toolId, await toolId("pipeline-pilot"))),
    );
    const otherTool = await toolId("chatterbox");

    const code = await postgresErrorCode(() =>
      db.insert(instances).values({
        key: "mismatched-contract",
        slug: "mismatched-contract",
        name: "Mismatched contract",
        toolId: otherTool,
        contractId: contract,
      }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("allow an instance with no contract", async () => {
    const tool = await toolId("pagewatch");
    const code = await postgresErrorCode(() =>
      db
        .insert(instances)
        .values({ key: "no-contract", slug: "no-contract", name: "No contract", toolId: tool }),
    );
    expect(code).toBeUndefined();
  });

  it("reject a contract whose supplier does not exist", async () => {
    const tool = await toolId("ledgerly");
    const code = await postgresErrorCode(() =>
      db.insert(contracts).values({ toolId: tool, supplierId: MISSING_ID }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("reject a business unit whose parent does not exist", async () => {
    const code = await postgresErrorCode(() =>
      db
        .insert(businessUnits)
        .values({ key: "orphan-unit", name: "Orphan unit", parentId: MISSING_ID }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("reject a page linked to a product, team or service that does not exist", async () => {
    const code = await postgresErrorCode(() =>
      db.insert(pages).values({
        slug: "orphan-page",
        pageType: "service_guide",
        title: "Orphan",
        bodyMarkdown: "No owner.",
        productTeamServiceId: MISSING_ID,
      }),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("reject join rows that point at records that do not exist", async () => {
    const tool = await toolId("pagewatch");
    const instance = await instanceId("pagewatch-production");
    const capability = await capabilityId("incident-alerting");

    const codes = [
      await postgresErrorCode(() =>
        db.insert(capabilityTools).values({ capabilityId: MISSING_ID, toolId: tool }),
      ),
      await postgresErrorCode(() =>
        db.insert(supplierTools).values({ supplierId: MISSING_ID, toolId: tool }),
      ),
      await postgresErrorCode(() =>
        db
          .insert(productTeamServiceInstances)
          .values({ productTeamServiceId: MISSING_ID, instanceId: instance }),
      ),
      await postgresErrorCode(() =>
        db.insert(instanceCapabilities).values({
          instanceId: instance,
          capabilityId: capability,
          productTeamServiceId: MISSING_ID,
        }),
      ),
      await postgresErrorCode(() =>
        db
          .insert(businessUnitProductTeamServices)
          .values({ businessUnitId: MISSING_ID, productTeamServiceId: MISSING_ID }),
      ),
    ];

    expect(codes).toEqual(Array<string>(5).fill(FOREIGN_KEY_VIOLATION));
  });

  it("stop a vendor being deleted while a tool still uses it", async () => {
    const code = await postgresErrorCode(() =>
      db.delete(vendors).where(eq(vendors.name, "Kestrel Cloud Ltd")),
    );
    expect(code).toBe(RESTRICT_VIOLATION);
  });

  it("stop an ownership level being deleted while an instance uses it", async () => {
    const level = await levelId("supported");
    const code = await postgresErrorCode(() =>
      db.delete(ownershipLevels).where(eq(ownershipLevels.id, level)),
    );
    expect(code).toBe(RESTRICT_VIOLATION);
  });

  it("stop a business unit being deleted while it has child units", async () => {
    const unit = await businessUnitId("digital-platforms");
    const code = await postgresErrorCode(() =>
      db.delete(businessUnits).where(eq(businessUnits.id, unit)),
    );
    expect(code).toBe(RESTRICT_VIOLATION);
  });

  it("remove a tool's join rows when the tool is deleted", async () => {
    const tool = await firstId(
      db
        .insert(tools)
        .values({ key: "short-lived", slug: "short-lived", name: "Short-lived tool" })
        .returning({ id: tools.id }),
    );
    const supplier = await firstId(db.select({ id: suppliers.id }).from(suppliers).limit(1));
    await db
      .insert(capabilityTools)
      .values({ capabilityId: await capabilityId("team-messaging"), toolId: tool });
    await db.insert(supplierTools).values({ supplierId: supplier, toolId: tool });

    await db.delete(tools).where(eq(tools.id, tool));

    expect(await db.$count(capabilityTools, eq(capabilityTools.toolId, tool))).toBe(0);
    expect(await db.$count(supplierTools, eq(supplierTools.toolId, tool))).toBe(0);
  });
});

describe("check constraints", () => {
  it("reject keys that are not lower-case words joined by hyphens", async () => {
    const badKeys = ["Has-Capitals", "has spaces", "trailing-", "double--hyphen", "snake_case"];
    const codes: (string | undefined)[] = [];
    for (const key of badKeys) {
      codes.push(
        await postgresErrorCode(() => db.insert(capabilities).values({ key, name: "Bad key" })),
      );
    }
    expect(codes).toEqual(Array<string>(5).fill(CHECK_VIOLATION));
  });

  it("reject a business unit that is its own parent", async () => {
    const unit = await businessUnitId("strategy-and-insight");
    const code = await postgresErrorCode(() =>
      db.update(businessUnits).set({ parentId: unit }).where(eq(businessUnits.id, unit)),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("reject two pages with the same slug", async () => {
    const page = { pageType: "general" as const, title: "Duplicate", bodyMarkdown: "Text." };
    await db.insert(pages).values({ ...page, slug: "duplicate-slug" });
    const code = await postgresErrorCode(() =>
      db.insert(pages).values({ ...page, slug: "duplicate-slug" }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("reject audit entries whose values do not match the action", async () => {
    const entry = {
      entityType: "tool",
      entityId: 1,
      actorName: "editor@example.com",
      actorSubject: "editor@example.com",
    };
    const codes = [
      await postgresErrorCode(() =>
        db
          .insert(auditLog)
          .values({ ...entry, action: "create", before: { name: "Old" }, after: { name: "New" } }),
      ),
      await postgresErrorCode(() =>
        db.insert(auditLog).values({ ...entry, action: "update", after: { name: "New" } }),
      ),
      await postgresErrorCode(() =>
        db
          .insert(auditLog)
          .values({ ...entry, action: "delete", before: { name: "Old" }, after: { name: "New" } }),
      ),
      await postgresErrorCode(() =>
        db.insert(auditLog).values({ ...entry, action: "publish", before: { status: "draft" } }),
      ),
    ];
    expect(codes).toEqual(Array<string>(4).fill(CHECK_VIOLATION));
  });

  it("reject an audit entry with a blank actor or non-list changed fields", async () => {
    const entry = {
      entityType: "tool",
      entityId: 1,
      action: "create" as const,
      after: { name: "New" },
    };
    const codes = [
      await postgresErrorCode(() =>
        db.insert(auditLog).values({ ...entry, actorName: " ", actorSubject: " " }),
      ),
      await postgresErrorCode(() =>
        db.insert(auditLog).values({
          ...entry,
          actorName: "editor@example.com",
          actorSubject: "editor@example.com",
          changedFields: sql`'{"name": true}'::jsonb`,
        }),
      ),
    ];
    expect(codes).toEqual(Array<string>(2).fill(CHECK_VIOLATION));
  });

  it("reject links that are not http or https URLs", async () => {
    const badUrls = [
      "javascript:alert(1)",
      "data:text/html,<p>hello</p>",
      "//example.com/no-scheme",
      "https://example.com/has space",
      "https://",
    ];
    const codes: (string | undefined)[] = [];
    for (const url of badUrls) {
      codes.push(
        await postgresErrorCode(() =>
          db.update(vendors).set({ url }).where(eq(vendors.slug, "kestrel-cloud")),
        ),
      );
    }
    codes.push(
      await postgresErrorCode(() =>
        db
          .update(productTeamServices)
          .set({ slackChannel: "javascript:alert(1)" })
          .where(eq(productTeamServices.key, "build-tools-team")),
      ),
    );
    expect(codes).toEqual(Array<string>(6).fill(CHECK_VIOLATION));
  });

  it("allow http and https links in any letter case", async () => {
    const code = await postgresErrorCode(() =>
      db
        .update(vendors)
        .set({ url: "HTTPS://Kestrel.example.com/Products?ref=hub" })
        .where(eq(vendors.slug, "kestrel-cloud")),
    );
    expect(code).toBeUndefined();
  });

  it("reject GitHub organisation names that are not valid GitHub names", async () => {
    const badLists = [
      sql`ARRAY['example-gds', '../evil']::text[]`,
      sql`ARRAY['has,comma']::text[]`,
      sql`ARRAY['']::text[]`,
      sql`ARRAY['-leading-hyphen']::text[]`,
      sql`ARRAY['example-gds', NULL]::text[]`,
      sql`ARRAY[ARRAY['nested']]::text[]`,
    ];
    const codes: (string | undefined)[] = [];
    for (const ghOrgs of badLists) {
      codes.push(
        await postgresErrorCode(() =>
          db
            .update(productTeamServices)
            .set({ ghOrgs })
            .where(eq(productTeamServices.key, "build-tools-team")),
        ),
      );
    }
    expect(codes).toEqual(Array<string>(6).fill(CHECK_VIOLATION));
  });

  it("allow an empty list of GitHub organisations", async () => {
    const code = await postgresErrorCode(() =>
      db
        .update(productTeamServices)
        .set({ ghOrgs: [] })
        .where(eq(productTeamServices.key, "data-insights-service")),
    );
    expect(code).toBeUndefined();
  });

  it("reject extra instance attributes that are not text", async () => {
    const badValues = [
      sql`'{"count": 1}'::jsonb`,
      sql`'{"nested": {"a": "b"}}'::jsonb`,
      sql`'{"list": ["x"]}'::jsonb`,
      sql`'{"empty": null}'::jsonb`,
      sql`'["not", "an", "object"]'::jsonb`,
    ];
    const codes: (string | undefined)[] = [];
    for (const extraAttributes of badValues) {
      codes.push(
        await postgresErrorCode(() =>
          db
            .update(instances)
            .set({ extraAttributes })
            .where(eq(instances.key, "sentinel-scan-gds")),
        ),
      );
    }
    expect(codes).toEqual(Array<string>(5).fill(CHECK_VIOLATION));
  });
});

describe("the search index", () => {
  it("includes every kind of searchable record and only published pages", async () => {
    const rows = await db.select().from(searchIndex);
    const kinds = [...new Set(rows.map((row) => row.entityType))].sort();
    const pageSlugs = rows.filter((row) => row.entityType === "page").map((row) => row.slug);

    expect(kinds).toEqual([
      "business_unit",
      "capability",
      "instance",
      "ownership_level",
      "page",
      "product_team_service",
      "tool",
      "vendor",
    ]);
    expect(pageSlugs).toContain("software-approval");
    expect(pageSlugs).not.toContain("on-call-handbook");
  });

  it("ranks a title match above a body-only match", async () => {
    await db.insert(pages).values([
      {
        slug: "kingfisher-in-the-body",
        pageType: "general",
        title: "Wildlife notes",
        bodyMarkdown: "We saw a kingfisher.",
      },
      {
        slug: "kingfisher-in-the-title",
        pageType: "general",
        title: "Kingfisher sightings",
        bodyMarkdown: "Notes.",
      },
    ]);
    const query = sql`websearch_to_tsquery('english', 'kingfisher')`;

    const results = await db
      .select({ slug: searchIndex.slug })
      .from(searchIndex)
      .where(sql`${searchIndex.searchVector} @@ ${query}`)
      .orderBy(desc(sql`ts_rank(${searchIndex.searchVector}, ${query})`));

    expect(results.map((row) => row.slug)).toEqual([
      "kingfisher-in-the-title",
      "kingfisher-in-the-body",
    ]);
  });
});

describe("the audit log", () => {
  it("rejects changes to existing entries", async () => {
    const code = await postgresErrorCode(() =>
      db.update(auditLog).set({ changeSummary: "Changed afterwards" }),
    );
    expect(code).toBe(RAISE_EXCEPTION);
  });

  it("rejects deleting entries", async () => {
    const code = await postgresErrorCode(() => db.delete(auditLog));
    expect(code).toBe(RAISE_EXCEPTION);
  });

  it("rejects emptying the table", async () => {
    const code = await postgresErrorCode(() => db.execute(sql`TRUNCATE audit_log`));
    expect(code).toBe(RAISE_EXCEPTION);
  });

  it("still accepts new entries", async () => {
    const code = await postgresErrorCode(() =>
      db.insert(auditLog).values({
        entityType: "tool",
        entityId: 1,
        action: "create",
        after: { name: "New" },
        actorName: "editor@example.com",
        actorSubject: "editor@example.com",
      }),
    );
    expect(code).toBeUndefined();
  });
});
