import { CATALOGUE_PATHS, HOME_PATH, SECTIONS } from "../site-map.js";
import type { PageType } from "../validation/catalogue.js";
import type { MigrationRecord, TargetEntity } from "./records.js";

/**
 * How the current Hub lays out its built site: which addresses are rendered
 * from the YAML data, which are listings, and what type of page everything
 * else becomes. This is structure only (paths and rules), never content.
 */

/** The element in a blog post that holds its "Published on" date. */
export const BLOG_DATE_SELECTOR = ".post-date";

/** Where the new site will show "What's new" posts and general pages (Phase 6). */
export const WHATS_NEW_PATH = "/whats-new";
export const GENERAL_PAGES_PATH = "/pages";

/**
 * Turns a name into a URL slug the way the current Hub does (Rails'
 * parameterize): accents are removed, anything other than letters, digits,
 * hyphens and underscores becomes a hyphen, and the result is lower case.
 */
export function parameterize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\-_]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * The name of the tool group page the current Hub makes for a capability
 * group: the words "Tool" and "Tools" are dropped and " Tools" is added. A
 * blank group, or one mentioning "other", becomes "Other Tools".
 */
export function toolGroupName(group: string | undefined): string {
  const trimmed = group?.trim() ?? "";
  if (trimmed === "" || /other/i.test(trimmed)) return "Other Tools";
  const base = trimmed
    .replace(/\btools?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return base === "" ? "Other Tools" : `${base} Tools`;
}

interface PageTypeRule {
  /** The start of a built path, relative to the build folder. */
  readonly prefix: string;
  readonly pageType: PageType;
}

/** Which section of the current Hub becomes which type of page. The first match wins. */
export const PAGE_TYPE_RULES: readonly PageTypeRule[] = [
  { prefix: "InfoSec/", pageType: "policy" },
  { prefix: "whats-new/", pageType: "whats_new" },
  { prefix: "engineering/", pageType: "service_guide" },
  { prefix: "service_desk_manual/", pageType: "guidance" },
  { prefix: "tools/", pageType: "guidance" },
];

/** Lower-case words of letters and digits joined by hyphens. */
function kebab(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Where a page of this type and slug will be on the new site. */
export function newPagePath(pageType: PageType, slug: string): string {
  switch (pageType) {
    case "policy":
      return `${SECTIONS.policies.path}/${slug}`;
    case "guidance":
    case "service_guide":
      return `${SECTIONS.guidance.path}/${slug}`;
    case "whats_new":
      return `${WHATS_NEW_PATH}/${slug}`;
    case "general":
      return `${GENERAL_PAGES_PATH}/${slug}`;
  }
}

export interface ContentPageTarget {
  readonly pageType: PageType;
  readonly slug: string;
  readonly newPath: string;
}

/**
 * The page type, slug and new address of a hand-written page. The section
 * prefix that sets the type is left out of the slug, and a section's own
 * index page takes the section's name.
 */
export function contentPageTarget(builtPath: string): ContentPageTarget {
  const rule = PAGE_TYPE_RULES.find(({ prefix }) => builtPath.startsWith(prefix));
  const rest = (rule === undefined ? builtPath : builtPath.slice(rule.prefix.length))
    .replace(/\.html?$/, "")
    .replace(/(^|\/)index$/, "");
  const base = rest === "" && rule !== undefined ? rule.prefix : rest;
  const slug = kebab(base) || "home";
  const pageType = rule?.pageType ?? "general";
  return { pageType, slug, newPath: newPagePath(pageType, slug) };
}

/** Record types that the current Hub renders a page for. */
export type RecordPageEntity = Extract<
  TargetEntity,
  "tool" | "instance" | "capability" | "business_unit" | "product_team_service"
>;

/** Where a record's page is on the new site. Every migrated record's slug is its key. */
export function recordPath(entity: RecordPageEntity, key: string): string {
  switch (entity) {
    case "tool":
      return CATALOGUE_PATHS.tool(key);
    case "instance":
      return CATALOGUE_PATHS.instance(key);
    case "capability":
      return CATALOGUE_PATHS.capability(key);
    case "business_unit":
      return CATALOGUE_PATHS.businessUnit(key);
    case "product_team_service":
      return CATALOGUE_PATHS.productTeamService(key);
  }
}

/** Lookups from the YAML records, for matching built addresses to records. */
export interface RecordIndex {
  readonly toolKeysByName: ReadonlyMap<string, string>;
  readonly toolGroupSlugs: ReadonlySet<string>;
  readonly capabilityKeys: ReadonlySet<string>;
  /** Real instances only: placeholders have no page of their own. */
  readonly instanceKeys: ReadonlySet<string>;
  readonly businessUnitKeysByName: ReadonlyMap<string, string>;
  readonly teamKeysByName: ReadonlyMap<string, string>;
}

function stringField(record: MigrationRecord, field: string): string | undefined {
  const value = record.fields[field];
  return typeof value === "string" ? value : undefined;
}

export function buildRecordIndex(records: readonly MigrationRecord[]): RecordIndex {
  const toolKeysByName = new Map<string, string>();
  const toolGroupSlugs = new Set<string>([parameterize(toolGroupName(undefined))]);
  const capabilityKeys = new Set<string>();
  const instanceKeys = new Set<string>();
  const businessUnitKeysByName = new Map<string, string>();
  const teamKeysByName = new Map<string, string>();

  const byName = (map: Map<string, string>, record: MigrationRecord) => {
    const name = parameterize(stringField(record, "name") ?? record.key);
    // Two records with the same name shared one page on the current Hub. The first wins.
    if (!map.has(name)) map.set(name, record.key);
  };

  for (const record of records) {
    switch (record.targetEntity) {
      case "tool":
        byName(toolKeysByName, record);
        break;
      case "capability":
        capabilityKeys.add(record.key);
        toolGroupSlugs.add(parameterize(toolGroupName(stringField(record, "groupName"))));
        break;
      case "instance":
        if (record.fields.isPlaceholder !== true) instanceKeys.add(record.key);
        break;
      case "business_unit":
        byName(businessUnitKeysByName, record);
        break;
      case "product_team_service":
        byName(teamKeysByName, record);
        break;
      default:
        break;
    }
  }
  return {
    toolKeysByName,
    toolGroupSlugs,
    capabilityKeys,
    instanceKeys,
    businessUnitKeysByName,
    teamKeysByName,
  };
}

export type PageMatch =
  | {
      readonly kind: "record";
      readonly entity: RecordPageEntity;
      /** Undefined if no record matches the address. */
      readonly key: string | undefined;
      /** True if the address also matches a tool group page. */
      readonly ambiguous: boolean;
    }
  | {
      readonly kind: "listing";
      /** The new page that replaces it, or undefined if there isn't one yet. */
      readonly replacement: string | undefined;
    }
  | { readonly kind: "content" };

/** Listing pages the current Hub builds from the YAML, and what replaces each. */
const LISTINGS: ReadonlyMap<string, string | undefined> = new Map([
  ["/", HOME_PATH],
  ["/tools/", SECTIONS.tools.path],
  ["/capabilities/", SECTIONS.capabilities.path],
  ["/instances/", SECTIONS.tools.path],
  ["/products_teams_and_services/", SECTIONS.services.path],
  ["/directorates/", SECTIONS.services.path],
  ["/ownership/", undefined],
  ["/search/", SECTIONS.search.path],
  ["/whats-new/", WHATS_NEW_PATH],
]);

const TOOL_PAGE = /^\/tools\/([^/]+)\/$/;
const CAPABILITY_GROUP_PAGE = /^\/capabilities\/[^/]+-capability-group\.html$/;
const CAPABILITY_PAGE = /^\/capabilities\/([^/]+)\.html$/;
const INSTANCE_PAGE = /^\/instances\/([^/]+)\.html$/;
const BUSINESS_UNIT_PAGE = /^\/products_teams_and_services\/([^/]+)\/$/;
const TEAM_PAGE = /^\/products_teams_and_services\/[^/]+\/([^/]+)\/$/;
const BLOG_LISTING_PAGE = /^\/whats-new\/page\/\d+\/$/;

function recordMatch(
  entity: RecordPageEntity,
  key: string | undefined,
  ambiguous = false,
): PageMatch {
  return { kind: "record", entity, key, ambiguous };
}

/**
 * What a built page at this old address is: a page rendered from a YAML
 * record, a listing rendered from the YAML, or a hand-written page.
 */
export function classifyOldPath(oldPath: string, index: RecordIndex): PageMatch {
  if (LISTINGS.has(oldPath)) return { kind: "listing", replacement: LISTINGS.get(oldPath) };
  if (BLOG_LISTING_PAGE.test(oldPath)) return { kind: "listing", replacement: WHATS_NEW_PATH };

  const tool = TOOL_PAGE.exec(oldPath)?.[1];
  if (tool !== undefined) {
    const key = index.toolKeysByName.get(tool);
    const isGroup = index.toolGroupSlugs.has(tool);
    if (key === undefined && isGroup) return { kind: "listing", replacement: SECTIONS.tools.path };
    return recordMatch("tool", key, key !== undefined && isGroup);
  }

  if (CAPABILITY_GROUP_PAGE.test(oldPath)) {
    return { kind: "listing", replacement: SECTIONS.capabilities.path };
  }
  const capability = CAPABILITY_PAGE.exec(oldPath)?.[1];
  if (capability !== undefined) {
    return recordMatch("capability", index.capabilityKeys.has(capability) ? capability : undefined);
  }

  const instance = INSTANCE_PAGE.exec(oldPath)?.[1];
  if (instance !== undefined) {
    return recordMatch("instance", index.instanceKeys.has(instance) ? instance : undefined);
  }

  const unit = BUSINESS_UNIT_PAGE.exec(oldPath)?.[1];
  if (unit !== undefined)
    return recordMatch("business_unit", index.businessUnitKeysByName.get(unit));

  const team = TEAM_PAGE.exec(oldPath)?.[1];
  if (team !== undefined)
    return recordMatch("product_team_service", index.teamKeysByName.get(team));

  return { kind: "content" };
}
