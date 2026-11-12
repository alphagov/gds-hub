import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { MigrationOptions } from "./config.js";
import { extractContent, hasContentArea, redirectTarget } from "./extractor.js";
import {
  buildRecordIndex,
  classifyOldPath,
  contentPageTarget,
  recordPath,
} from "./hub-structure.js";
import { findNewPath, oldPathOf, redirectOldPath } from "./links.js";
import {
  needsManualReview,
  warning,
  type MigrationRecord,
  type MigrationWarning,
  type TargetEntity,
  type ValidationIssue,
} from "./records.js";
import { validateRecords } from "./validate.js";
import { recordsFromYaml, type DataFile } from "./yaml-records.js";

/**
 * Takes stock of everything to migrate: every built page and every data
 * file, each ending as migrated, skipped with a reason, or for manual
 * review. Pages rendered from the YAML are matched to their records and only
 * become redirects, so nothing is migrated twice. Hand-written pages are
 * converted from the built HTML. Nothing is written anywhere.
 */

export type ItemKind =
  "data_file" | "record_page" | "content_page" | "listing_page" | "redirect_page" | "unknown_page";

export type ItemStatus = "migrated" | "skipped" | "manual_review";

export interface InventoryItem {
  /** A built page's path in the build folder, or a data file's path in the data folder. */
  readonly path: string;
  readonly kind: ItemKind;
  readonly status: ItemStatus;
  readonly reason: string;
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly target?: { readonly entity: TargetEntity; readonly key: string };
  readonly warnings: readonly MigrationWarning[];
}

export interface AssetReference {
  /** The old path of an image or download. */
  readonly path: string;
  /** Whether the build folder has it. */
  readonly exists: boolean;
  /** The built pages that link to it. */
  readonly referencedBy: readonly string[];
}

export interface MigrationPlan {
  readonly items: readonly InventoryItem[];
  readonly records: readonly MigrationRecord[];
  readonly issues: readonly ValidationIssue[];
  readonly assets: readonly AssetReference[];
}

const HTML_FILE = /\.html?$/i;
const YAML_FILE = /\.ya?ml$/i;
const ASSET_FILE =
  /\.(png|jpe?g|gif|svg|webp|ico|bmp|pdf|docx?|xlsx?|pptx?|odt|ods|odp|csv|txt|zip)$/i;

/** Redirect pages can point at other redirect pages. Give up after this many steps. */
const MAX_REDIRECT_STEPS = 10;

/** Every file under a folder, as sorted paths with "/" separators. Symbolic links aren't followed. */
async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  };
  await walk(root, "");
  return found.sort();
}

interface PendingRedirect {
  readonly builtPath: string;
  readonly oldPath: string;
  readonly newPath: string;
}

export async function buildMigrationPlan(options: MigrationOptions): Promise<MigrationPlan> {
  const items: InventoryItem[] = [];

  // The YAML data files.
  const dataPaths = await listFiles(options.dataDir);
  const yamlPaths = dataPaths.filter((file) => YAML_FILE.test(file));
  const dataFiles: DataFile[] = await Promise.all(
    yamlPaths.map(async (sourcePath) => ({
      sourcePath,
      text: await readFile(path.join(options.dataDir, sourcePath), "utf8"),
    })),
  );
  const yaml = recordsFromYaml(dataFiles);
  for (const file of dataPaths) {
    const records = yaml.records.filter((record) => record.sourcePath === file).length;
    const hasIssues = yaml.issues.some((issue) => issue.sourcePath === file);
    if (!YAML_FILE.test(file)) {
      items.push({
        path: file,
        kind: "data_file",
        status: "manual_review",
        reason: "not a YAML file",
        warnings: [],
      });
    } else if (yaml.unknownFiles.includes(file)) {
      items.push({
        path: file,
        kind: "data_file",
        status: "manual_review",
        reason: "not a data file the migration knows how to read",
        warnings: [],
      });
    } else {
      const warnings = yaml.fileWarnings.get(file) ?? [];
      const review = hasIssues || needsManualReview(warnings);
      let reason = `read into ${records} records`;
      if (hasIssues) reason += ", with validation issues";
      else if (review) reason += ", with warnings that need a person to check";
      items.push({
        path: file,
        kind: "data_file",
        status: review ? "manual_review" : "migrated",
        reason,
        warnings,
      });
    }
  }

  // The built pages: first work out what each one is and where it goes.
  const index = buildRecordIndex(yaml.records);
  const builtFiles = await listFiles(options.buildDir);
  const builtFileSet = new Set(builtFiles);
  const pathMap = new Map<string, string>();
  const redirects: PendingRedirect[] = [];
  const builtPathOfRecord = new Map<string, string>();
  const contentPages: { builtPath: string; oldPath: string; html: string }[] = [];
  const redirectPages: { builtPath: string; oldPath: string; target: string }[] = [];
  const pageItems = new Map<string, InventoryItem>();

  for (const builtPath of builtFiles.filter((file) => HTML_FILE.test(file))) {
    const oldPath = oldPathOf(builtPath);
    const match = classifyOldPath(oldPath, index);

    if (match.kind === "record") {
      if (match.key === undefined) {
        pageItems.set(builtPath, {
          path: builtPath,
          kind: "record_page",
          status: "manual_review",
          reason: `rendered from the YAML, but no ${match.entity.replace(/_/g, " ")} record matches its address`,
          oldPath,
          warnings: [],
        });
        continue;
      }
      const newPath = recordPath(match.entity, match.key);
      pathMap.set(oldPath, newPath);
      redirects.push({ builtPath, oldPath, newPath });
      const recordId = `${match.entity}:${match.key}`;
      if (!builtPathOfRecord.has(recordId)) builtPathOfRecord.set(recordId, builtPath);
      pageItems.set(builtPath, {
        path: builtPath,
        kind: "record_page",
        status: match.ambiguous ? "manual_review" : "migrated",
        reason:
          "rendered from the YAML, whose record is migrated instead, so it becomes a redirect",
        oldPath,
        newPath,
        target: { entity: match.entity, key: match.key },
        warnings: match.ambiguous
          ? [warning("ambiguous_page", "its address is also a tool group page on the current Hub")]
          : [],
      });
      continue;
    }

    if (match.kind === "listing") {
      if (match.replacement === undefined) {
        pageItems.set(builtPath, {
          path: builtPath,
          kind: "listing_page",
          status: "manual_review",
          reason: "a listing rendered from the YAML, with no replacement page yet",
          oldPath,
          warnings: [],
        });
        continue;
      }
      pathMap.set(oldPath, match.replacement);
      if (match.replacement !== oldPath) {
        redirects.push({ builtPath, oldPath, newPath: match.replacement });
      }
      pageItems.set(builtPath, {
        path: builtPath,
        kind: "listing_page",
        status: "skipped",
        reason: `a listing rendered from the YAML, replaced by ${match.replacement}`,
        oldPath,
        newPath: match.replacement,
        warnings: [],
      });
      continue;
    }

    const html = await readFile(path.join(options.buildDir, builtPath), "utf8");
    if (hasContentArea(html, options.contentSelector)) {
      const { newPath } = contentPageTarget(builtPath);
      pathMap.set(oldPath, newPath);
      redirects.push({ builtPath, oldPath, newPath });
      contentPages.push({ builtPath, oldPath, html });
      continue;
    }
    const target = redirectTarget(html);
    if (target !== undefined) {
      redirectPages.push({ builtPath, oldPath, target });
      continue;
    }
    pageItems.set(builtPath, {
      path: builtPath,
      kind: "unknown_page",
      status: "manual_review",
      reason: "it has no content area and isn't a redirect",
      oldPath,
      warnings: [],
    });
  }

  // Redirect pages go to wherever their target went, following chains. A
  // target on another site is undefined, so it is never mistaken for one here.
  const redirectTargets = new Map(
    redirectPages.map((page) => [
      page.oldPath,
      redirectOldPath(page.target, page.oldPath, options.siteOrigins),
    ]),
  );
  const resolvedRedirects = new Map<string, string>();
  for (const page of redirectPages) {
    let current = redirectTargets.get(page.oldPath);
    let newPath: string | undefined;
    for (let step = 0; step < MAX_REDIRECT_STEPS && current !== undefined; step += 1) {
      newPath = findNewPath(current, pathMap);
      if (newPath !== undefined) break;
      current = redirectTargets.get(current);
    }
    if (newPath === undefined) {
      const offSite = redirectTargets.get(page.oldPath) === undefined;
      pageItems.set(page.builtPath, {
        path: page.builtPath,
        kind: "redirect_page",
        status: "manual_review",
        reason: offSite
          ? "a redirect page that goes to another site"
          : "a redirect page whose target isn't a migrated page",
        oldPath: page.oldPath,
        warnings: [
          warning(
            "unresolved_redirect",
            offSite
              ? "the redirect goes to another site, and the new Hub only redirects to its own pages"
              : "the redirect's target doesn't match a migrated page",
          ),
        ],
      });
      continue;
    }
    resolvedRedirects.set(page.oldPath, newPath);
    redirects.push({ builtPath: page.builtPath, oldPath: page.oldPath, newPath });
    pageItems.set(page.builtPath, {
      path: page.builtPath,
      kind: "redirect_page",
      status: "migrated",
      reason: "a redirect page, which becomes a redirect",
      oldPath: page.oldPath,
      newPath,
      warnings: [],
    });
  }
  for (const [oldPath, newPath] of resolvedRedirects) pathMap.set(oldPath, newPath);

  // Then convert the hand-written pages, with every new address known.
  const pageRecords: MigrationRecord[] = [];
  const assetUses = new Map<string, Set<string>>();
  for (const page of contentPages) {
    const target = contentPageTarget(page.builtPath);
    const extracted = extractContent(page.html, {
      contentSelector: options.contentSelector,
      stripSelectors: options.stripSelectors,
      link: {
        pagePath: page.oldPath,
        siteOrigins: options.siteOrigins,
        assetBasePath: options.assetBasePath,
        pathMap,
      },
    });
    for (const asset of extracted.assets) {
      const users = assetUses.get(asset) ?? new Set<string>();
      users.add(page.builtPath);
      assetUses.set(asset, users);
    }
    pageRecords.push({
      sourcePath: page.builtPath,
      sourceType: "html",
      builtPath: page.builtPath,
      targetEntity: "page",
      key: target.slug,
      slug: target.slug,
      fields: {
        slug: target.slug,
        title: extracted.title ?? target.slug,
        pageType: target.pageType,
        summary: null,
        ownerName: null,
        ownerContact: null,
        status: "published",
        lastReviewedAt: null,
        publishedAt: extracted.publishedDate ?? null,
      },
      bodyMarkdown: extracted.bodyMarkdown,
      warnings: extracted.warnings,
    });
    const review = needsManualReview(extracted.warnings);
    pageItems.set(page.builtPath, {
      path: page.builtPath,
      kind: "content_page",
      status: review ? "manual_review" : "migrated",
      reason: review
        ? "converted from the built HTML, with warnings that need a person to check"
        : "converted from the built HTML",
      oldPath: page.oldPath,
      newPath: target.newPath,
      warnings: extracted.warnings,
    });
  }

  for (const builtPath of builtFiles) {
    const pageItem = pageItems.get(builtPath);
    if (pageItem !== undefined) items.push(pageItem);
  }

  // Each YAML record notes the built page it was rendered to.
  const yamlRecords = yaml.records.map((record): MigrationRecord => {
    const builtPath = builtPathOfRecord.get(`${record.targetEntity}:${record.key}`);
    return builtPath === undefined ? record : { ...record, builtPath };
  });

  const redirectRecords = redirects.map((redirect): MigrationRecord => ({
    sourcePath: redirect.builtPath,
    sourceType: "html",
    builtPath: redirect.builtPath,
    targetEntity: "redirect",
    key: redirect.oldPath,
    slug: redirect.oldPath,
    fields: { oldPath: redirect.oldPath, newPath: redirect.newPath },
    warnings: [],
  }));

  const records = [...yamlRecords, ...pageRecords, ...redirectRecords];

  // Images and downloads: those the pages use, and any others in the build.
  const assetPaths = new Set<string>(assetUses.keys());
  for (const file of builtFiles) {
    if (ASSET_FILE.test(file)) assetPaths.add(`/${file}`);
  }
  const assets = [...assetPaths].sort().map((assetPath): AssetReference => ({
    path: assetPath,
    exists: builtFileSet.has(decodePath(assetPath.slice(1))),
    referencedBy: [...(assetUses.get(assetPath) ?? [])].sort(),
  }));

  return {
    items,
    records,
    issues: [...yaml.issues, ...validateRecords(records)],
    assets,
  };
}

/** A URL path's characters as they are on disk, for checking a file exists. */
function decodePath(urlPath: string): string {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return urlPath;
  }
}
