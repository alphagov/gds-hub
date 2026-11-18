import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OBJECT_BYTES,
  MigrationStorageError,
  s3ReportTarget,
  s3Source,
} from "../../../src/migration/storage/index.js";
import { FakeS3 } from "./fake-s3.js";

const BUCKET = "example-hub-migration";

function bucketWith(objects: Record<string, string>): FakeS3 {
  const s3 = new FakeS3();
  for (const [key, body] of Object.entries(objects)) s3.put(BUCKET, key, body);
  return s3;
}

describe("an S3 prefix as a migration input", () => {
  it("lists every object under the prefix as a path relative to it, sorted", async () => {
    const s3 = bucketWith({
      "hub-build/tools/kettle-board/index.html": "SYNTHETIC FIXTURE",
      "hub-build/about.html": "SYNTHETIC FIXTURE",
      "hub-data/tools.yml": "# SYNTHETIC FIXTURE",
    });
    const source = s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3);
    expect(await source.list()).toEqual(["about.html", "tools/kettle-board/index.html"]);
    expect(s3.listRequests[0]).toEqual({ bucket: BUCKET, prefix: "hub-build/" });
  });

  it("follows every page of a long listing", async () => {
    const objects: Record<string, string> = {};
    for (let n = 0; n < 7; n += 1) objects[`hub-build/page-${n}.html`] = "SYNTHETIC FIXTURE";
    const s3 = bucketWith(objects);
    s3.pageSize = 3;
    const paths = await s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3).list();
    expect(paths).toHaveLength(7);
    expect(s3.listRequests).toHaveLength(3);
    expect(s3.listRequests[1]?.continuationToken).toBeDefined();
  });

  it("lists a whole bucket when the prefix is empty", async () => {
    const s3 = bucketWith({
      "tools.yml": "# SYNTHETIC FIXTURE",
      "instances.yml": "# SYNTHETIC FIXTURE",
    });
    expect(await s3Source({ bucket: BUCKET, prefix: "" }, s3).list()).toEqual([
      "instances.yml",
      "tools.yml",
    ]);
  });

  it("skips folder markers, which aren't files", async () => {
    const s3 = bucketWith({
      "hub-build/": "",
      "hub-build/tools/": "",
      "hub-build/tools/index.html": "SYNTHETIC FIXTURE",
    });
    expect(await s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3).list()).toEqual([
      "tools/index.html",
    ]);
  });

  it.each([
    ["a parent folder step", "hub-build/../secret.html"],
    ["a current folder step", "hub-build/./about.html"],
    ["an empty folder name", "hub-build/tools//index.html"],
    ["a backslash", "hub-build/tools\\index.html"],
    ["a control character", "hub-build/about\u0000.html"],
  ])("refuses to list a key with %s, rather than guess what it means", async (_case, key) => {
    const s3 = bucketWith({
      "hub-build/about.html": "SYNTHETIC FIXTURE",
      [key]: "SYNTHETIC FIXTURE",
    });
    await expect(
      s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3).list(),
    ).rejects.toBeInstanceOf(MigrationStorageError);
  });

  it("reads an object as text, from under the prefix", async () => {
    const s3 = bucketWith({ "hub-data/tools.yml": "# SYNTHETIC FIXTURE\nexample: {}\n" });
    const source = s3Source({ bucket: BUCKET, prefix: "hub-data/" }, s3);
    expect(await source.readText("tools.yml")).toBe("# SYNTHETIC FIXTURE\nexample: {}\n");
    expect(s3.reads).toEqual([`${BUCKET}/hub-data/tools.yml`]);
  });

  it("refuses an object larger than the limit before downloading it", async () => {
    const s3 = bucketWith({ "hub-build/huge.html": "x".repeat(2048) });
    const source = s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3, { maxObjectBytes: 1024 });
    await source.list();
    await expect(source.readText("huge.html")).rejects.toBeInstanceOf(MigrationStorageError);
    expect(s3.reads).toEqual([]);
  });

  it("has a generous default size limit for built pages and data files", () => {
    expect(DEFAULT_MAX_OBJECT_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
  });

  it("refuses to read a path that would leave the prefix", async () => {
    const s3 = bucketWith({ "secret.html": "SYNTHETIC FIXTURE" });
    const source = s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3);
    await expect(source.readText("../secret.html")).rejects.toBeInstanceOf(MigrationStorageError);
    expect(s3.reads).toEqual([]);
  });

  it("is labelled with its s3:// address for the logs", () => {
    expect(s3Source({ bucket: BUCKET, prefix: "hub-build/" }, new FakeS3()).label).toBe(
      `s3://${BUCKET}/hub-build/`,
    );
  });
});

describe("an S3 prefix for reports", () => {
  it("writes a report as JSON under the prefix and returns its s3:// address", async () => {
    const s3 = new FakeS3();
    const written = await s3ReportTarget({ bucket: BUCKET, prefix: "reports/" }, s3).write(
      "load-2026-11-12.json",
      '{"ok":true}\n',
    );
    expect(written).toBe(`s3://${BUCKET}/reports/load-2026-11-12.json`);
    expect(s3.get(BUCKET, "reports/load-2026-11-12.json")).toBe('{"ok":true}\n');
  });

  it("never replaces an earlier report", async () => {
    const s3 = new FakeS3();
    const target = s3ReportTarget({ bucket: BUCKET, prefix: "reports/" }, s3);
    await target.write("verify-1.json", "first\n");
    await expect(target.write("verify-1.json", "second\n")).rejects.toThrow();
    expect(s3.get(BUCKET, "reports/verify-1.json")).toBe("first\n");
  });

  it("refuses a report name that isn't a plain file name", async () => {
    const s3 = new FakeS3();
    await expect(
      s3ReportTarget({ bucket: BUCKET, prefix: "reports/" }, s3).write("../escape.json", "{}"),
    ).rejects.toBeInstanceOf(MigrationStorageError);
    expect(s3.keys(BUCKET)).toEqual([]);
  });
});
