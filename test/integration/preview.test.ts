import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import type { Database } from "../../src/db/client.js";
import { createPreviewSigner } from "../../src/editing/preview-signing.js";
import { createTestModeIdentity } from "../../src/editing/test-mode.js";
import { silentLogger } from "../../src/lib/logger.js";
import { createRepositories } from "../../src/repositories/index.js";
import { systemActor } from "../../src/services/audit/actor.js";
import { createCatalogueService } from "../../src/services/catalogue/catalogue-service.js";
import { createContentService } from "../../src/services/content/content-service.js";
import { createEditService } from "../../src/services/editing/edit-service.js";
import { createRedirectService } from "../../src/services/redirects/redirect-service.js";
import { startApp, testConfig, type RunningApp } from "../unit/helpers.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// Previewing against a real database: nothing in any table changes, and a
// save from the preview writes the previewed values and one audit entry.

vi.setConfig({ testTimeout: 30_000 });

const SECRET = "integration-secret-".padEnd(40, "x");
let testDatabase: TestDatabase | undefined;
let db: Database;
let running: RunningApp | undefined;
let vendorId: number;
let loadedAt: string;

/** Every table's row count and a fingerprint of its contents, so any change shows. */
async function snapshot(): Promise<Record<string, string>> {
  const tables = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const result: Record<string, string> = {};
  for (const { table_name: name } of tables.rows) {
    const rows = await db.execute<{ fingerprint: string }>(
      sql.raw(
        `SELECT count(*) || ':' || coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS fingerprint FROM "${name}" t`,
      ),
    );
    result[name] = rows.rows[0]?.fingerprint ?? "";
  }
  return result;
}

async function post(path: string, body: Record<string, string>): Promise<Response> {
  return fetch(`${running?.baseUrl ?? ""}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  db = created.db;
  const repos = createRepositories(created.db);
  const vendor = await repos.vendors.create(
    { slug: "compass-co", name: "Compass Co", description: "Makes compasses." },
    systemActor("unauthenticated_test_mode"),
  );
  vendorId = vendor.id;
  loadedAt = new Date((vendor as { updatedAt: Date }).updatedAt).toISOString();
  running = await startApp(
    createApp({
      config: testConfig,
      logger: silentLogger,
      catalogue: createCatalogueService(repos),
      content: createContentService(repos),
      redirects: createRedirectService(repos),
      editing: {
        identity: createTestModeIdentity(),
        service: createEditService(repos),
        previewSigner: createPreviewSigner({ secret: SECRET }),
      },
    }),
  );
});

afterAll(async () => {
  await running?.close();
  await testDatabase?.drop();
});

function previewValues(): Record<string, string> {
  return {
    slug: "compass-co",
    name: "Compass Co Renamed",
    description: "Words typed but not yet saved.",
    url: "",
    updatedAt: loadedAt,
  };
}

describe("previewing", () => {
  it("changes no table, including the audit log", async () => {
    const before = await snapshot();

    const changed = await post(`/edit/vendors/${vendorId}/preview`, previewValues());
    const added = await post("/edit/vendors/preview", { ...previewValues(), slug: "new-co" });
    const invalid = await post(`/edit/vendors/${vendorId}/preview`, {
      ...previewValues(),
      name: "",
    });

    expect([changed.status, added.status, invalid.status]).toEqual([200, 200, 400]);
    expect(await changed.text()).toContain("Words typed but not yet saved.");
    expect(await snapshot()).toEqual(before);
  });

  it("changes no table when the payload is tampered with", async () => {
    const before = await snapshot();

    const response = await post(`/edit/vendors/${vendorId}/publish`, { preview: "forged.payload" });

    expect(response.status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });
});

describe("saving from a preview", () => {
  it("writes the previewed values and one audit entry for the unverified test mode actor", async () => {
    const preview = await post(`/edit/vendors/${vendorId}/preview`, previewValues());
    const html = await preview.text();
    const token = /name="preview"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? "";
    const before = await snapshot();

    const saved = await post(`/edit/vendors/${vendorId}/publish`, { preview: token });

    expect(saved.status).toBe(303);
    const after = await snapshot();
    expect(after.vendors).not.toBe(before.vendors);
    const audit = await db.execute<{ action: string; actor_subject: string }>(
      sql`SELECT action, actor_subject FROM audit_log WHERE entity_type = 'vendor' AND entity_id = ${vendorId} ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toEqual({
      action: "update",
      actor_subject: "system:unauthenticated_test_mode",
    });
    const read = await fetch(`${running?.baseUrl ?? ""}/vendors/compass-co`);
    expect(await read.text()).toContain("Compass Co Renamed");
  });

  it("is refused after someone else changes the record, and writes nothing", async () => {
    const stale = await post(`/edit/vendors/${vendorId}/preview`, {
      ...previewValues(),
      name: "Stale Co",
    });
    const token = /name="preview"[^>]*value="([^"]+)"/.exec(await stale.text())?.[1] ?? "";
    const before = await snapshot();

    const response = await post(`/edit/vendors/${vendorId}/publish`, { preview: token });

    expect(response.status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });
});
