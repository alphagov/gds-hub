import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CONTENT_SELECTOR,
  DEFAULT_REPORT_DIR,
  DEFAULT_STRIP_SELECTORS,
  MigrationConfigError,
  REPO_ROOT,
  loadMigrationOptions,
  type MigrationArgs,
} from "../../../src/migration/config.js";
import { FIXTURE_BUILD_DIR, FIXTURE_DATA_DIR } from "./helpers.js";

const outside = mkdtempSync(path.join(os.tmpdir(), "gds-hub-migration-config-"));
const outsideData = mkdtempSync(path.join(outside, "data-"));
const outsideBuild = mkdtempSync(path.join(outside, "build-"));

afterAll(() => {
  rmSync(outside, { recursive: true, force: true });
});

function issuesFrom(args: MigrationArgs, env: NodeJS.ProcessEnv = {}): readonly string[] {
  try {
    loadMigrationOptions(args, env);
  } catch (error) {
    if (error instanceof MigrationConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected the options to be refused");
}

describe("migration options", () => {
  it("reads the data and build directories from the environment", () => {
    const options = loadMigrationOptions(
      {},
      { HUB_DATA_DIR: outsideData, HUB_BUILD_DIR: outsideBuild },
    );
    expect(options.data).toEqual({
      kind: "local",
      dir: expect.stringContaining(path.basename(outsideData)),
    });
    expect(options.build).toEqual({
      kind: "local",
      dir: expect.stringContaining(path.basename(outsideBuild)),
    });
  });

  it("prefers command-line options to the environment", () => {
    const options = loadMigrationOptions(
      { data: FIXTURE_DATA_DIR, build: FIXTURE_BUILD_DIR },
      { HUB_DATA_DIR: outsideData, HUB_BUILD_DIR: outsideBuild },
    );
    expect(options.data).toEqual({ kind: "local", dir: FIXTURE_DATA_DIR });
    expect(options.build).toEqual({ kind: "local", dir: FIXTURE_BUILD_DIR });
  });

  it("fails fast, naming both settings, when the directories are unset", () => {
    const issues = issuesFrom({}, { HUB_DATA_DIR: "", HUB_BUILD_DIR: "" });
    expect(issues.join("\n")).toContain("HUB_DATA_DIR");
    expect(issues.join("\n")).toContain("HUB_BUILD_DIR");
  });

  it("fails fast when a directory does not exist", () => {
    const issues = issuesFrom({ data: path.join(outside, "missing"), build: outsideBuild });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("HUB_DATA_DIR");
  });

  it("fails fast when a directory is inside this repository", () => {
    const issues = issuesFrom({ data: outsideData, build: path.join(REPO_ROOT, "src") });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("HUB_BUILD_DIR");
    expect(issues[0]).toContain("inside this repository");
  });

  it("fails fast when a directory contains this repository", () => {
    const issues = issuesFrom({ data: path.dirname(REPO_ROOT), build: outsideBuild });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("HUB_DATA_DIR");
  });

  it("follows symbolic links before checking where a directory is", () => {
    const link = path.join(outside, "link-into-repo");
    symlinkSync(path.join(REPO_ROOT, "docs"), link);
    const issues = issuesFrom({ data: link, build: outsideBuild });
    expect(issues[0]).toContain("inside this repository");
  });

  it("allows the synthetic fixture folders inside the repository", () => {
    expect(() =>
      loadMigrationOptions({ data: FIXTURE_DATA_DIR, build: FIXTURE_BUILD_DIR }, {}),
    ).not.toThrow();
  });

  it("refuses a report directory inside the repository that git doesn't ignore", () => {
    const issues = issuesFrom({
      data: outsideData,
      build: outsideBuild,
      reportDir: path.join(REPO_ROOT, "docs"),
    });
    expect(issues[0]).toContain("MIGRATION_REPORT_DIR");
  });

  it("writes reports to the git-ignored migration-reports folder by default", () => {
    const options = loadMigrationOptions({ data: outsideData, build: outsideBuild }, {});
    expect(options.reports).toEqual({ kind: "local", dir: DEFAULT_REPORT_DIR });
    expect(path.relative(REPO_ROOT, DEFAULT_REPORT_DIR)).toBe("migration-reports");
  });

  it("uses the default content selector and strip-list unless told otherwise", () => {
    const options = loadMigrationOptions({ data: outsideData, build: outsideBuild }, {});
    expect(options.contentSelector).toBe(DEFAULT_CONTENT_SELECTOR);
    expect(options.stripSelectors).toEqual(DEFAULT_STRIP_SELECTORS);
    expect(options.assetBasePath).toBe("/hub-assets");
    expect(options.siteOrigins).toEqual([]);
  });

  it("reads the content selector, extra strip selectors and site address from the environment", () => {
    const options = loadMigrationOptions(
      { data: outsideData, build: outsideBuild },
      {
        MIGRATION_CONTENT_SELECTOR: "main#content",
        MIGRATION_STRIP_SELECTORS: ".example-banner, .example-notice",
        MIGRATION_SITE_ORIGIN: "https://hub.example.com/some/page",
        MIGRATION_ASSET_BASE_PATH: "/old-hub-files",
      },
    );
    expect(options.contentSelector).toBe("main#content");
    expect(options.stripSelectors).toEqual([
      ...DEFAULT_STRIP_SELECTORS,
      ".example-banner",
      ".example-notice",
    ]);
    expect(options.siteOrigins).toEqual(["https://hub.example.com"]);
    expect(options.assetBasePath).toBe("/old-hub-files");
  });

  it("refuses a content selector that isn't valid CSS", () => {
    const issues = issuesFrom({ data: outsideData, build: outsideBuild, contentSelector: "main[" });
    expect(issues[0]).toContain("MIGRATION_CONTENT_SELECTOR");
  });

  it("refuses a site address that isn't an http or https URL", () => {
    const issues = issuesFrom({
      data: outsideData,
      build: outsideBuild,
      siteOrigin: "javascript:alert(1)",
    });
    expect(issues[0]).toContain("MIGRATION_SITE_ORIGIN");
  });

  it("refuses an asset path that doesn't start with a single slash", () => {
    const issues = issuesFrom({
      data: outsideData,
      build: outsideBuild,
      assetBasePath: "//cdn.example.com",
    });
    expect(issues[0]).toContain("MIGRATION_ASSET_BASE_PATH");
  });
});

describe("migration options for S3", () => {
  it("reads s3:// addresses for the data and build, with each prefix ending in a slash", () => {
    const options = loadMigrationOptions(
      {
        data: "s3://example-hub-migration/hub-data",
        build: "s3://example-hub-migration/hub-build/",
      },
      {},
    );
    expect(options.data).toEqual({
      kind: "s3",
      bucket: "example-hub-migration",
      prefix: "hub-data/",
    });
    expect(options.build).toEqual({
      kind: "s3",
      bucket: "example-hub-migration",
      prefix: "hub-build/",
    });
  });

  it("reads s3:// addresses from the environment too", () => {
    const options = loadMigrationOptions(
      {},
      {
        HUB_DATA_DIR: "s3://example-hub-migration/frozen/hub-data/",
        HUB_BUILD_DIR: "s3://example-hub-migration/frozen/hub-build/",
      },
    );
    expect(options.data).toEqual({
      kind: "s3",
      bucket: "example-hub-migration",
      prefix: "frozen/hub-data/",
    });
  });

  it("allows a whole bucket, with an empty prefix", () => {
    const options = loadMigrationOptions(
      { data: "s3://example-hub-data", build: "s3://example-hub-build/" },
      {},
    );
    expect(options.data).toEqual({ kind: "s3", bucket: "example-hub-data", prefix: "" });
    expect(options.build).toEqual({ kind: "s3", bucket: "example-hub-build", prefix: "" });
  });

  it("can mix a local folder and an S3 address", () => {
    const options = loadMigrationOptions(
      { data: outsideData, build: "s3://example-hub-migration/hub-build/" },
      {},
    );
    expect(options.data.kind).toBe("local");
    expect(options.build.kind).toBe("s3");
  });

  it.each([
    ["no bucket", "s3://"],
    ["a bucket name with capital letters", "s3://Example-Bucket/hub-data/"],
    ["a bucket name that is too short", "s3://ab/hub-data/"],
    ["a bucket name with an underscore", "s3://example_bucket/hub-data/"],
    ["a query string", "s3://example-bucket/hub-data/?versionId=1"],
    ["a fragment", "s3://example-bucket/hub-data/#top"],
    ["a parent folder step", "s3://example-bucket/hub-data/../other/"],
    ["an empty folder name", "s3://example-bucket/hub-data//build/"],
    ["a backslash", "s3://example-bucket/hub\\data/"],
    ["credentials", "s3://key:secret@example-bucket/hub-data/"],
  ])("refuses an S3 address with %s", (_case, address) => {
    const issues = issuesFrom({ data: address, build: outsideBuild });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("HUB_DATA_DIR");
    expect(issues[0]).toContain("s3://");
  });

  it("never repeats a refused address in its message", () => {
    const issues = issuesFrom({
      data: "s3://key:secret@example-bucket/hub-data/",
      build: outsideBuild,
    });
    expect(issues.join("\n")).not.toContain("secret");
  });

  it("refuses any other kind of address", () => {
    const issues = issuesFrom({ data: "https://example.com/hub-data/", build: outsideBuild });
    expect(issues[0]).toContain("HUB_DATA_DIR");
  });

  it("writes reports to an s3:// address when given one", () => {
    const options = loadMigrationOptions(
      {
        data: "s3://example-hub-migration/hub-data/",
        build: "s3://example-hub-migration/hub-build/",
        reportDir: "s3://example-hub-migration/reports",
      },
      {},
    );
    expect(options.reports).toEqual({
      kind: "s3",
      bucket: "example-hub-migration",
      prefix: "reports/",
    });
  });

  it("refuses a report address that isn't valid", () => {
    const issues = issuesFrom({
      data: outsideData,
      build: outsideBuild,
      reportDir: "s3://Example/reports/",
    });
    expect(issues[0]).toContain("MIGRATION_REPORT_DIR");
  });
});

describe("the database host option", () => {
  it("is unset unless given", () => {
    const options = loadMigrationOptions({ data: outsideData, build: outsideBuild }, {});
    expect(options.databaseHost).toBeUndefined();
  });

  it("is read from the command line, then the environment", () => {
    expect(
      loadMigrationOptions(
        { data: outsideData, build: outsideBuild, databaseHost: "hub.cluster.example.com" },
        { MIGRATION_DATABASE_HOST: "other.example.com" },
      ).databaseHost,
    ).toBe("hub.cluster.example.com");
    expect(
      loadMigrationOptions(
        { data: outsideData, build: outsideBuild },
        { MIGRATION_DATABASE_HOST: "other.example.com" },
      ).databaseHost,
    ).toBe("other.example.com");
  });

  it("refuses something that isn't a host name", () => {
    const issues = issuesFrom({
      data: outsideData,
      build: outsideBuild,
      databaseHost: "db.example.com/other",
    });
    expect(issues[0]).toContain("MIGRATION_DATABASE_HOST");
  });
});

describe("local folders given with ~", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are found in the home folder, even from .env where no shell expands them", () => {
    vi.stubEnv("HOME", outside);
    const options = loadMigrationOptions(
      {},
      {
        HUB_DATA_DIR: `~/${path.basename(outsideData)}`,
        HUB_BUILD_DIR: `~/${path.basename(outsideBuild)}`,
      },
    );
    expect(options.data).toEqual({
      kind: "local",
      dir: expect.stringContaining(path.basename(outsideData)),
    });
    expect(options.build.kind).toBe("local");
  });

  it("say which folder couldn't be found", () => {
    vi.stubEnv("HOME", outside);
    const issues = issuesFrom({ data: "~/no-such-folder", build: outsideBuild });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(path.join(outside, "no-such-folder"));
  });
});
