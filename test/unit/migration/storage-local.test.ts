import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MigrationStorageError,
  localReportTarget,
  localSource,
} from "../../../src/migration/storage/index.js";

const root = mkdtempSync(path.join(os.tmpdir(), "gds-hub-migration-storage-"));
const folder = path.join(root, "input");
mkdirSync(path.join(folder, "tools", "kettle-board"), { recursive: true });
writeFileSync(path.join(folder, "tools", "kettle-board", "index.html"), "<p>SYNTHETIC FIXTURE</p>");
writeFileSync(path.join(folder, "about.html"), "<p>SYNTHETIC FIXTURE about</p>");
writeFileSync(path.join(root, "outside.html"), "<p>SYNTHETIC FIXTURE outside</p>");
symlinkSync(path.join(root, "outside.html"), path.join(folder, "linked.html"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a local folder as a migration input", () => {
  it("lists every file as a sorted path with forward slashes", async () => {
    expect(await localSource(folder).list()).toEqual([
      "about.html",
      "tools/kettle-board/index.html",
    ]);
  });

  it("doesn't follow symbolic links", async () => {
    expect(await localSource(folder).list()).not.toContain("linked.html");
  });

  it("reads a listed file as text", async () => {
    expect(await localSource(folder).readText("tools/kettle-board/index.html")).toBe(
      "<p>SYNTHETIC FIXTURE</p>",
    );
  });

  it("refuses to read a path outside the folder", async () => {
    await expect(localSource(folder).readText("../outside.html")).rejects.toBeInstanceOf(
      MigrationStorageError,
    );
    await expect(
      localSource(folder).readText(path.join(root, "outside.html")),
    ).rejects.toBeInstanceOf(MigrationStorageError);
  });

  it("is labelled with its folder for the logs", () => {
    expect(localSource(folder).label).toBe(folder);
  });
});

describe("a local folder for reports", () => {
  it("writes a report, creating the folder, and returns where it went", async () => {
    const dir = path.join(root, "reports", "nested");
    const written = await localReportTarget(dir).write("load-2026-11-12.json", '{"ok":true}\n');
    expect(written).toBe(path.join(dir, "load-2026-11-12.json"));
    expect(readFileSync(written, "utf8")).toBe('{"ok":true}\n');
  });

  it("never replaces an earlier report", async () => {
    const dir = path.join(root, "reports", "once");
    const target = localReportTarget(dir);
    await target.write("verify-1.json", "first\n");
    await expect(target.write("verify-1.json", "second\n")).rejects.toThrow();
    expect(readFileSync(path.join(dir, "verify-1.json"), "utf8")).toBe("first\n");
    expect(readdirSync(dir)).toEqual(["verify-1.json"]);
  });

  it("refuses a report name that isn't a plain file name", async () => {
    await expect(
      localReportTarget(path.join(root, "reports")).write("../escape.json", "{}"),
    ).rejects.toBeInstanceOf(MigrationStorageError);
  });
});
