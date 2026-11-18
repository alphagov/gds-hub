import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrationOptions } from "../../../src/migration/config.js";
import { openStorage } from "../../../src/migration/storage/index.js";
import { FakeS3 } from "./fake-s3.js";
import { FIXTURE_BUILD_DIR, FIXTURE_DATA_DIR } from "./helpers.js";

const BUCKET = "example-hub-migration";

describe("opening the migration's inputs and report location", () => {
  it("uses local folders without ever making an S3 client", async () => {
    const options = loadMigrationOptions(
      {
        data: FIXTURE_DATA_DIR,
        build: FIXTURE_BUILD_DIR,
        reportDir: path.join(os.tmpdir(), "gds-hub-migration-tests"),
      },
      {},
    );
    let clients = 0;
    const storage = openStorage(options, () => {
      clients += 1;
      return new FakeS3();
    });
    expect(storage.sources.data.label).toBe(FIXTURE_DATA_DIR);
    expect(await storage.sources.data.list()).toContain("tools.yml");
    // The report folder is resolved to its real path (os.tmpdir() is a symbolic link on macOS).
    expect(options.reports.kind).toBe("local");
    expect(storage.reports.label).toBe(options.reports.kind === "local" ? options.reports.dir : "");
    expect(clients).toBe(0);
  });

  it("uses S3 for s3:// addresses, sharing one client", async () => {
    const options = loadMigrationOptions(
      {
        data: `s3://${BUCKET}/hub-data/`,
        build: `s3://${BUCKET}/hub-build/`,
        reportDir: `s3://${BUCKET}/reports/`,
      },
      {},
    );
    const s3 = new FakeS3();
    s3.put(BUCKET, "hub-data/tools.yml", "# SYNTHETIC FIXTURE\n");
    let clients = 0;
    const storage = openStorage(options, () => {
      clients += 1;
      return s3;
    });
    expect(storage.sources.data.label).toBe(`s3://${BUCKET}/hub-data/`);
    expect(storage.sources.build.label).toBe(`s3://${BUCKET}/hub-build/`);
    expect(storage.reports.label).toBe(`s3://${BUCKET}/reports/`);
    expect(await storage.sources.data.list()).toEqual(["tools.yml"]);
    await storage.reports.write("inventory-1.json", "{}\n");
    expect(s3.get(BUCKET, "reports/inventory-1.json")).toBe("{}\n");
    expect(clients).toBe(1);
  });
});
