import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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
    expect(options.dataDir).toContain(path.basename(outsideData));
    expect(options.buildDir).toContain(path.basename(outsideBuild));
  });

  it("prefers command-line options to the environment", () => {
    const options = loadMigrationOptions(
      { data: FIXTURE_DATA_DIR, build: FIXTURE_BUILD_DIR },
      { HUB_DATA_DIR: outsideData, HUB_BUILD_DIR: outsideBuild },
    );
    expect(options.dataDir).toBe(FIXTURE_DATA_DIR);
    expect(options.buildDir).toBe(FIXTURE_BUILD_DIR);
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
    expect(options.reportDir).toBe(DEFAULT_REPORT_DIR);
    expect(path.relative(REPO_ROOT, options.reportDir)).toBe("migration-reports");
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
