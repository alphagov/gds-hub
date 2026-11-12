import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

/** This repository's root (src/migration/ or dist/migration/ is two levels down). */
export const REPO_ROOT = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));

/** The synthetic fixtures: the only input folders allowed inside the repository. */
export const FIXTURES_DIR = path.join(REPO_ROOT, "test", "fixtures", "migration");

/** Where reports go unless told otherwise. Git ignores it. */
export const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, "migration-reports");

/** The element that holds a built page's content. The developer sets the real one. */
export const DEFAULT_CONTENT_SELECTOR = "main";

/**
 * Parts of the content area that belong to the layout, not the page: in-page
 * contents, "last reviewed" lines, feedback links and blog date lines (the date
 * is read before it is removed). Extra selectors are added to these.
 */
export const DEFAULT_STRIP_SELECTORS: readonly string[] = [
  "nav",
  ".toc",
  "#toc",
  "[class*='page-review']",
  "[class*='page-expiry']",
  ".contribution-banner",
  ".feedback",
  ".post-date",
];

/** Where links to images and downloads point until hosting them is decided. */
export const DEFAULT_ASSET_BASE_PATH = "/hub-assets";

/** Settings from the command line. Each one overrides its environment variable. */
export interface MigrationArgs {
  readonly data?: string | undefined;
  readonly build?: string | undefined;
  readonly contentSelector?: string | undefined;
  readonly strip?: string | undefined;
  readonly siteOrigin?: string | undefined;
  readonly assetBasePath?: string | undefined;
  readonly reportDir?: string | undefined;
}

export interface MigrationOptions {
  /** The folder of YAML data files. */
  readonly dataDir: string;
  /** The folder of built HTML. */
  readonly buildDir: string;
  readonly contentSelector: string;
  readonly stripSelectors: readonly string[];
  /** Origins of the old site. Absolute links to them are treated as internal. */
  readonly siteOrigins: readonly string[];
  readonly assetBasePath: string;
  readonly reportDir: string;
}

export class MigrationConfigError extends Error {
  override readonly name = "MigrationConfigError";

  constructor(readonly issues: readonly string[]) {
    super(`Invalid migration settings:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
  }
}

/** Whether `child` is `parent` or inside it. Both must be resolved paths. */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** A setting's value, treating blank as unset. */
function setting(arg: string | undefined, value: string | undefined): string | undefined {
  const chosen = arg ?? value;
  if (chosen === undefined) return undefined;
  const trimmed = chosen.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The real path of something that may not exist yet: its nearest existing parent, resolved. */
function resolvePossiblyMissing(target: string): string {
  const absolute = path.resolve(target);
  let existing = absolute;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    existing = parent;
  }
  return path.join(realpathSync(existing), path.relative(existing, absolute));
}

function isValidSelector(selector: string): boolean {
  try {
    load("<p></p>")(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the migration settings from the command line and the environment.
 * Throws MigrationConfigError listing every problem, before anything is read.
 *
 * Input folders must exist and sit outside this repository (so real Hub
 * files can never be committed by accident), except the synthetic fixtures.
 * Symbolic links are followed first.
 */
export function loadMigrationOptions(
  args: MigrationArgs,
  env: NodeJS.ProcessEnv,
  repoRoot: string = REPO_ROOT,
): MigrationOptions {
  const issues: string[] = [];
  const fixturesDir = path.join(repoRoot, "test", "fixtures", "migration");

  const inputDirectory = (raw: string | undefined, label: string): string => {
    if (raw === undefined) {
      issues.push(`${label} is not set`);
      return "";
    }
    let resolved: string;
    try {
      resolved = realpathSync(path.resolve(raw));
    } catch {
      issues.push(`${label} does not exist`);
      return "";
    }
    if (!statSync(resolved).isDirectory()) {
      issues.push(`${label} is not a directory`);
      return "";
    }
    if (isInside(resolved, fixturesDir)) return resolved;
    if (isInside(resolved, repoRoot)) {
      issues.push(
        `${label} is inside this repository. Keep the current Hub's files outside it, so they can't be committed`,
      );
    } else if (isInside(repoRoot, resolved)) {
      issues.push(`${label} contains this repository. Point it at the current Hub's own folder`);
    }
    return resolved;
  };

  const dataDir = inputDirectory(setting(args.data, env.HUB_DATA_DIR), "HUB_DATA_DIR (or --data)");
  const buildDir = inputDirectory(
    setting(args.build, env.HUB_BUILD_DIR),
    "HUB_BUILD_DIR (or --build)",
  );

  const contentSelector =
    setting(args.contentSelector, env.MIGRATION_CONTENT_SELECTOR) ?? DEFAULT_CONTENT_SELECTOR;
  if (!isValidSelector(contentSelector)) {
    issues.push("MIGRATION_CONTENT_SELECTOR (or --content-selector) is not a valid CSS selector");
  }

  const extraStrip = (setting(args.strip, env.MIGRATION_STRIP_SELECTORS) ?? "")
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "");
  if (!extraStrip.every(isValidSelector)) {
    issues.push("MIGRATION_STRIP_SELECTORS (or --strip) has a selector that isn't valid CSS");
  }

  const siteOrigins: string[] = [];
  for (const raw of (setting(args.siteOrigin, env.MIGRATION_SITE_ORIGIN) ?? "").split(",")) {
    const value = raw.trim();
    if (value === "") continue;
    let url: URL | undefined;
    try {
      url = new URL(value);
    } catch {
      url = undefined;
    }
    if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
      issues.push("MIGRATION_SITE_ORIGIN (or --site-origin) must be http or https web addresses");
    } else if (!siteOrigins.includes(url.origin)) {
      siteOrigins.push(url.origin);
    }
  }

  const assetBasePath = (
    setting(args.assetBasePath, env.MIGRATION_ASSET_BASE_PATH) ?? DEFAULT_ASSET_BASE_PATH
  ).replace(/\/+$/, "");
  if (!/^\/(?![/\\])[A-Za-z0-9._~/-]+$/.test(assetBasePath)) {
    issues.push(
      "MIGRATION_ASSET_BASE_PATH (or --asset-base-path) must be a path on this site, such as /hub-assets",
    );
  }

  const reportDir = resolvePossiblyMissing(
    setting(args.reportDir, env.MIGRATION_REPORT_DIR) ?? path.join(repoRoot, "migration-reports"),
  );
  const ignoredOutputDirs = [
    path.join(repoRoot, "migration-reports"),
    path.join(repoRoot, "migration-data"),
  ];
  if (isInside(reportDir, repoRoot) && !ignoredOutputDirs.some((dir) => isInside(reportDir, dir))) {
    issues.push(
      "MIGRATION_REPORT_DIR (or --report-dir) is inside this repository but not in migration-reports/ or migration-data/, which git ignores",
    );
  }

  if (issues.length > 0) throw new MigrationConfigError(issues);

  return Object.freeze({
    dataDir,
    buildDir,
    contentSelector,
    stripSelectors: Object.freeze([...DEFAULT_STRIP_SELECTORS, ...extraStrip]),
    siteOrigins: Object.freeze(siteOrigins),
    assetBasePath,
    reportDir,
  });
}
