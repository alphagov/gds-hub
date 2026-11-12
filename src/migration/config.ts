import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import type { S3Location, StorageLocation } from "./storage/types.js";

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
  readonly databaseHost?: string | undefined;
}

export interface MigrationOptions {
  /** The YAML data files: a local folder or an S3 prefix. */
  readonly data: StorageLocation;
  /** The built HTML: a local folder or an S3 prefix. */
  readonly build: StorageLocation;
  readonly contentSelector: string;
  readonly stripSelectors: readonly string[];
  /** Origins of the old site. Absolute links to them are treated as internal. */
  readonly siteOrigins: readonly string[];
  readonly assetBasePath: string;
  /** Where reports go: a local folder or an S3 prefix. */
  readonly reports: StorageLocation;
  /**
   * The database host the load and verify scripts may use when it isn't a
   * local one. It must match the host in DATABASE_URL (see database-target.ts).
   */
  readonly databaseHost: string | undefined;
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

/**
 * A local path with a leading ~ replaced by the home folder. A shell does
 * this, but not for a value in .env, in quotes or after "=".
 */
export function expandHome(raw: string): string {
  if (raw === "~") return os.homedir();
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
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

/** S3 bucket naming rules: 3 to 63 lower-case letters, digits, dots and hyphens. */
const S3_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

const S3_SCHEME = /^s3:\/\//i;

/** Any other kind of address, such as https://. */
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * An s3://bucket/prefix address as a location, or undefined if it isn't a
 * plain one: a valid bucket name, and a prefix of plain folder names with no
 * query, fragment, parent steps, backslashes or spaces. The prefix is given a
 * trailing slash, so it only matches whole folder names.
 */
export function parseS3Location(address: string): S3Location | undefined {
  const rest = address.replace(S3_SCHEME, "");
  const slash = rest.indexOf("/");
  const bucket = slash === -1 ? rest : rest.slice(0, slash);
  let prefix = slash === -1 ? "" : rest.slice(slash + 1);
  if (!S3_BUCKET.test(bucket) || bucket.includes("..")) return undefined;
  if (/[?#\\\s\p{Cc}]/u.test(prefix)) return undefined;
  if (prefix !== "" && !prefix.endsWith("/")) prefix = `${prefix}/`;
  if (prefix !== "") {
    const segments = prefix.slice(0, -1).split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      return undefined;
    }
  }
  return { kind: "s3", bucket, prefix };
}

/** A host name or IPv4 address, as in a DATABASE_URL. */
const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/**
 * Reads the migration settings from the command line and the environment.
 * Throws MigrationConfigError listing every problem, before anything is read.
 *
 * Inputs are local folders or s3:// addresses. Local folders must exist and
 * sit outside this repository (so real Hub files can never be committed by
 * accident), except the synthetic fixtures. Symbolic links are followed
 * first. Messages never repeat a refused address, which could hold a
 * credential.
 */
export function loadMigrationOptions(
  args: MigrationArgs,
  env: NodeJS.ProcessEnv,
  repoRoot: string = REPO_ROOT,
): MigrationOptions {
  const issues: string[] = [];
  const fixturesDir = path.join(repoRoot, "test", "fixtures", "migration");

  const unset: StorageLocation = { kind: "local", dir: "" };

  const inputLocation = (raw: string | undefined, label: string): StorageLocation => {
    if (raw === undefined) {
      issues.push(`${label} is not set`);
      return unset;
    }
    if (S3_SCHEME.test(raw)) {
      const location = parseS3Location(raw);
      if (location === undefined) {
        issues.push(
          `${label} must be an s3://bucket/prefix/ address with a valid bucket name and plain folder names`,
        );
        return unset;
      }
      return location;
    }
    if (OTHER_SCHEME.test(raw)) {
      issues.push(`${label} must be a local folder or an s3:// address`);
      return unset;
    }
    const dir = inputDirectory(raw, label);
    return { kind: "local", dir };
  };

  const inputDirectory = (raw: string, label: string): string => {
    let resolved: string;
    try {
      resolved = realpathSync(path.resolve(expandHome(raw)));
    } catch {
      // A local path is safe to show, and says where it looked. Relative
      // paths are from the repository root, where npm runs the scripts.
      issues.push(`${label} does not exist: no folder at ${path.resolve(expandHome(raw))}`);
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

  const data = inputLocation(setting(args.data, env.HUB_DATA_DIR), "HUB_DATA_DIR (or --data)");
  const build = inputLocation(setting(args.build, env.HUB_BUILD_DIR), "HUB_BUILD_DIR (or --build)");

  const reportLocation = (raw: string | undefined): StorageLocation => {
    if (raw !== undefined && S3_SCHEME.test(raw)) {
      const location = parseS3Location(raw);
      if (location === undefined) {
        issues.push(
          "MIGRATION_REPORT_DIR (or --report-dir) must be an s3://bucket/prefix/ address with a valid bucket name and plain folder names",
        );
        return unset;
      }
      return location;
    }
    const dir = resolvePossiblyMissing(
      raw === undefined ? path.join(repoRoot, "migration-reports") : expandHome(raw),
    );
    const ignoredOutputDirs = [
      path.join(repoRoot, "migration-reports"),
      path.join(repoRoot, "migration-data"),
    ];
    if (isInside(dir, repoRoot) && !ignoredOutputDirs.some((ignored) => isInside(dir, ignored))) {
      issues.push(
        "MIGRATION_REPORT_DIR (or --report-dir) is inside this repository but not in migration-reports/ or migration-data/, which git ignores",
      );
    }
    return { kind: "local", dir };
  };

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

  const reports = reportLocation(setting(args.reportDir, env.MIGRATION_REPORT_DIR));

  const databaseHost = setting(args.databaseHost, env.MIGRATION_DATABASE_HOST);
  if (databaseHost !== undefined && !HOST_NAME.test(databaseHost)) {
    issues.push(
      "MIGRATION_DATABASE_HOST (or --database-host) must be a host name, such as the one in DATABASE_URL",
    );
  }

  if (issues.length > 0) throw new MigrationConfigError(issues);

  return Object.freeze({
    data,
    build,
    contentSelector,
    stripSelectors: Object.freeze([...DEFAULT_STRIP_SELECTORS, ...extraStrip]),
    siteOrigins: Object.freeze(siteOrigins),
    assetBasePath,
    reports,
    databaseHost,
  });
}
