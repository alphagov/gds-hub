import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { load } from "cheerio";
import { createApp } from "../app.js";
import type { Config } from "../config.js";
import type { Logger } from "../lib/logger.js";
import type { MigrationSnapshot, Repositories } from "../repositories/index.js";
import { valuesEqual } from "../services/audit/changes.js";
import { createCatalogueService } from "../services/catalogue/catalogue-service.js";
import { createRedirectService } from "../services/redirects/redirect-service.js";
import { SECTIONS } from "../site-map.js";
import {
  GENERAL_PAGES_PATH,
  WHATS_NEW_PATH,
  recordPath,
  type RecordPageEntity,
} from "./hub-structure.js";
import type { MigrationPlan } from "./inventory.js";
import {
  LoadMappingError,
  createLoadMapping,
  type IdLookup,
  type LinkRows,
} from "./load-mapping.js";
import { existingIds, recordId, recordsOnlyInDatabase } from "./loader.js";
import type { MigrationRecord, TargetEntity } from "./records.js";
import { REPORT_KIND } from "./report.js";
import type { MigrationSources } from "./storage/types.js";

/**
 * Checks a loaded migration against its plan, without writing anything:
 *
 * - every record is in the database with the plan's values and links
 * - every page rendered from the YAML now has a page on the new site, with
 *   the same title as the old one (the comparison with the Phase 4 pages)
 * - every old address redirects to its new page, and that page exists
 *
 * The new pages are fetched from the app itself, started on a random local
 * port against the same database. Findings name records, fields and paths,
 * never values or content.
 */

export type VerifyCode =
  | "missing_record"
  | "different_value"
  | "missing_link"
  | "extra_link"
  | "page_not_found"
  | "title_differs"
  | "redirect_missing"
  | "redirect_wrong_target"
  | "redirect_shadowed"
  | "redirect_chain"
  | "redirect_target_missing"
  | "only_in_database";

export interface VerifyFinding {
  readonly code: VerifyCode;
  readonly entity?: TargetEntity;
  readonly key?: string;
  readonly field?: string;
  readonly path?: string;
  readonly message: string;
}

export interface VerifyOutcome {
  /** True if there are no problems. Warnings need a person to look, but don't fail. */
  readonly passed: boolean;
  readonly checked: {
    readonly records: number;
    readonly pages: number;
    readonly redirects: number;
  };
  readonly problems: readonly VerifyFinding[];
  readonly warnings: readonly VerifyFinding[];
  /** Redirect targets for content pages, whose routes come in Phase 6. */
  readonly waitingForPhase6: readonly string[];
}

export interface VerifyReport extends VerifyOutcome {
  readonly kind: typeof REPORT_KIND;
  readonly report: "verify";
  readonly createdAt: string;
}

export interface VerifyInput {
  readonly plan: MigrationPlan;
  readonly sources: MigrationSources;
  readonly contentSelector: string;
  readonly repositories: Repositories;
  readonly config: Config;
  readonly logger: Logger;
}

/** The sections content pages go in, which have no page routes until Phase 6. */
const CONTENT_SECTIONS = [
  SECTIONS.policies.path,
  SECTIONS.guidance.path,
  WHATS_NEW_PATH,
  GENERAL_PAGES_PATH,
];

const RECORD_PAGE_ENTITIES: ReadonlySet<TargetEntity> = new Set<RecordPageEntity>([
  "tool",
  "instance",
  "capability",
  "business_unit",
  "product_team_service",
]);

const FETCH_TIMEOUT_MS = 10_000;

const ENTITY_NAMES: Readonly<Record<TargetEntity, string>> = {
  ownership_level: "ownership level",
  tool: "tool",
  contract: "contract",
  instance: "instance",
  capability: "capability",
  product_team_service: "product, team or service",
  business_unit: "business unit",
  page: "page",
  redirect: "redirect",
};

function withoutSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function withoutFragment(path: string): string {
  const hash = path.indexOf("#");
  return hash === -1 ? path : path.slice(0, hash);
}

function normalisedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The current rows of a record type, by ID. */
function rowsById(snapshot: MigrationSnapshot): Map<string, Readonly<Record<string, unknown>>> {
  const rows = new Map<string, Readonly<Record<string, unknown>>>();
  const add = (entity: TargetEntity, list: readonly { readonly id: number }[]) => {
    for (const row of list) rows.set(`${entity}#${String(row.id)}`, row);
  };
  add("ownership_level", snapshot.ownershipLevels);
  add("tool", snapshot.tools);
  add("contract", snapshot.contracts);
  add("instance", snapshot.instances);
  add("capability", snapshot.capabilities);
  add("product_team_service", snapshot.productTeamServices);
  add("business_unit", snapshot.businessUnits);
  add("page", snapshot.pages);
  add("redirect", snapshot.redirects);
  return rows;
}

interface Fetched {
  readonly status: number;
  readonly location: string | null;
  readonly html: string;
}

interface RunningApp {
  get(path: string): Promise<Fetched>;
  close(): Promise<void>;
}

/** Starts the app on a random local port, against the same database. */
async function startApp(input: VerifyInput): Promise<RunningApp> {
  const app = createApp({
    config: input.config,
    logger: input.logger,
    catalogue: createCatalogueService(input.repositories),
    redirects: createRedirectService(input.repositories),
  });
  const server: Server = await new Promise((resolve, reject) => {
    const started = app.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve(started);
    });
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${String(port)}`;
  return {
    async get(path) {
      const response = await fetch(`${base}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return {
        status: response.status,
        location: response.headers.get("location"),
        html: await response.text(),
      };
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

/** The text of the first h1, inside `selector` if one is given. */
function mainHeading(html: string, selector?: string): string | undefined {
  const $ = load(html);
  const headings = selector === undefined ? $("h1") : $(selector).first().find("h1");
  const heading = headings.first();
  return heading.length === 0 ? undefined : normalisedText(heading.text());
}

export async function verifyMigration(input: VerifyInput): Promise<VerifyOutcome> {
  const { plan, repositories } = input;
  const problems: VerifyFinding[] = [];
  const warnings: VerifyFinding[] = [];
  const waiting = new Set<string>();
  const checked = { records: 0, pages: 0, redirects: 0 };

  const snapshot = await repositories.migration.snapshot();
  const ids = existingIds(snapshot, plan.records);
  const idOf: IdLookup = (entity, key) => ids.get(recordId(entity, key));
  const rows = rowsById(snapshot);
  const mapping = createLoadMapping(plan.records);

  // Every record, with the plan's values.
  for (const record of plan.records) {
    checked.records += 1;
    const { targetEntity: entity, key } = record;
    const id = idOf(entity, key);
    const row = id === undefined ? undefined : rows.get(`${entity}#${String(id)}`);
    if (row === undefined) {
      problems.push({
        code: "missing_record",
        entity,
        key,
        message: `the ${ENTITY_NAMES[entity]} isn't in the database`,
      });
      continue;
    }
    let expected: Record<string, unknown>;
    try {
      expected = mapping.columnValues(record, idOf);
    } catch (error) {
      // A record it refers to is missing, which is reported for that record.
      if (error instanceof LoadMappingError) continue;
      throw error;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (!valuesEqual(row[field], value)) {
        problems.push({
          code: "different_value",
          entity,
          key,
          field,
          message: `${field} isn't what the current Hub has`,
        });
      }
    }
  }

  // Every link between records.
  let desired: LinkRows | undefined;
  try {
    desired = mapping.linkRows(idOf);
  } catch (error) {
    if (!(error instanceof LoadMappingError)) throw error;
  }
  if (desired !== undefined) checkLinks(desired, snapshot, plan.records, idOf, problems, warnings);

  for (const extra of recordsOnlyInDatabase(snapshot, plan.records)) {
    warnings.push({
      code: "only_in_database",
      entity: extra.entity,
      key: extra.key,
      message: `the ${ENTITY_NAMES[extra.entity]} is in the database but not in the current Hub`,
    });
  }

  const app = await startApp(input);
  try {
    // The new page for every page rendered from the YAML.
    for (const record of plan.records) {
      if (!RECORD_PAGE_ENTITIES.has(record.targetEntity) || record.builtPath === undefined)
        continue;
      if (idOf(record.targetEntity, record.key) === undefined) continue;
      checked.pages += 1;
      const path = recordPath(record.targetEntity as RecordPageEntity, record.key);
      const page = await app.get(path);
      if (page.status !== 200) {
        problems.push({
          code: "page_not_found",
          entity: record.targetEntity,
          key: record.key,
          path,
          message: `the new page gave status ${String(page.status)}`,
        });
        continue;
      }
      const oldTitle = mainHeading(
        await input.sources.build.readText(record.builtPath),
        input.contentSelector,
      );
      const newTitle = mainHeading(page.html);
      if (oldTitle !== newTitle) {
        warnings.push({
          code: "title_differs",
          entity: record.targetEntity,
          key: record.key,
          path,
          message: "the new page's heading isn't the same as the old page's",
        });
      }
    }

    // Every old address.
    const stored = new Map(snapshot.redirects.map((row) => [row.oldPath, row.newPath]));
    const pageSlugs = new Set(snapshot.pages.map((row) => row.slug));
    for (const record of plan.records) {
      if (record.targetEntity !== "redirect") continue;
      checked.redirects += 1;
      const oldPath = record.key;
      const newPath = typeof record.fields.newPath === "string" ? record.fields.newPath : "";
      if (!stored.has(oldPath)) {
        problems.push({
          code: "redirect_missing",
          path: oldPath,
          message: "the redirect isn't in the database",
        });
        continue;
      }

      const response = await app.get(oldPath);
      const samePage = withoutSlash(oldPath) === withoutSlash(newPath);
      let reachesTarget: boolean;
      if (response.status === 301 || response.status === 308) {
        reachesTarget = response.location === newPath;
      } else {
        // The old address is the new one but for its trailing slash, which
        // Express ignores, so it reaches the page directly.
        reachesTarget = samePage && (response.status === 200 || response.status === 404);
      }
      if (!reachesTarget) {
        const hidden = response.status === 200;
        problems.push({
          code: hidden ? "redirect_shadowed" : "redirect_wrong_target",
          path: oldPath,
          message: hidden
            ? "another page is at the old address, so the redirect never happens"
            : `the old address gave status ${String(response.status)}, not a redirect to its new page`,
        });
        continue;
      }

      const target = withoutFragment(newPath);
      const landed = samePage && response.status !== 404 ? response : await app.get(target);
      if (landed.status === 200) continue;
      if (landed.status === 301 || landed.status === 308) {
        problems.push({
          code: "redirect_chain",
          path: oldPath,
          message: "the new page redirects again",
        });
        continue;
      }
      if (isWaitingForContentRoute(target, pageSlugs)) {
        waiting.add(target);
        continue;
      }
      problems.push({
        code: "redirect_target_missing",
        path: oldPath,
        message: `the new page gave status ${String(landed.status)}`,
      });
    }
  } finally {
    await app.close();
  }

  return {
    passed: problems.length === 0,
    checked,
    problems,
    warnings,
    waitingForPhase6: [...waiting].sort(),
  };
}

/**
 * Whether a path is a content section, or a content page that is in the
 * database, so it only needs Phase 6's routes.
 */
function isWaitingForContentRoute(path: string, pageSlugs: ReadonlySet<string>): boolean {
  const target = withoutSlash(path);
  for (const section of CONTENT_SECTIONS) {
    if (target === section) return true;
    if (target.startsWith(`${section}/`)) {
      const slug = target.slice(section.length + 1);
      return !slug.includes("/") && pageSlugs.has(slug);
    }
  }
  return false;
}

function checkLinks(
  desired: LinkRows,
  snapshot: MigrationSnapshot,
  records: readonly MigrationRecord[],
  idOf: IdLookup,
  problems: VerifyFinding[],
  warnings: VerifyFinding[],
): void {
  const keysById = (entity: TargetEntity) =>
    new Map(
      records
        .filter((record) => record.targetEntity === entity)
        .flatMap((record): [number, string][] => {
          const id = idOf(entity, record.key);
          return id === undefined ? [] : [[id, record.key]];
        }),
    );

  const compare = <Want, Have>(
    entity: TargetEntity,
    wanted: readonly Want[],
    have: readonly Have[],
    parentOfWant: (row: Want) => number,
    parentOfHave: (row: Have) => number,
    pairOfWant: (row: Want) => string,
    pairOfHave: (row: Have) => string,
    sameDetails: (want: Want, have: Have) => boolean = () => true,
  ) => {
    const parents = keysById(entity);
    const existing = new Map(
      have.filter((row) => parents.has(parentOfHave(row))).map((row) => [pairOfHave(row), row]),
    );
    const wantedPairs = new Set<string>();
    for (const want of wanted) {
      const key = parents.get(parentOfWant(want));
      if (key === undefined) continue;
      const pair = pairOfWant(want);
      wantedPairs.add(pair);
      const found = existing.get(pair);
      if (found === undefined) {
        problems.push({
          code: "missing_link",
          entity,
          key,
          message: `a link from the ${ENTITY_NAMES[entity]} that the current Hub has is missing`,
        });
      } else if (!sameDetails(want, found)) {
        problems.push({
          code: "different_value",
          entity,
          key,
          field: "links",
          message: `the order of the ${ENTITY_NAMES[entity]}'s links isn't what the current Hub has`,
        });
      }
    }
    for (const [pair, row] of existing) {
      if (wantedPairs.has(pair)) continue;
      warnings.push({
        code: "extra_link",
        entity,
        key: parents.get(parentOfHave(row)) ?? "",
        message: `the ${ENTITY_NAMES[entity]} has a link the current Hub doesn't`,
      });
    }
  };

  compare(
    "capability",
    desired.capabilityTools,
    snapshot.capabilityTools,
    (row) => row.capabilityId,
    (row) => row.capabilityId,
    (row) => `${String(row.capabilityId)}:${String(row.toolId)}`,
    (row) => `${String(row.capabilityId)}:${String(row.toolId)}`,
    (want, have) => want.position === have.position,
  );
  compare(
    "product_team_service",
    desired.productTeamServiceInstances,
    snapshot.productTeamServiceInstances,
    (row) => row.productTeamServiceId,
    (row) => row.productTeamServiceId,
    (row) => `${String(row.productTeamServiceId)}:${String(row.instanceId)}`,
    (row) => `${String(row.productTeamServiceId)}:${String(row.instanceId)}`,
  );
  compare(
    "business_unit",
    desired.businessUnitProductTeamServices,
    snapshot.businessUnitProductTeamServices,
    (row) => row.businessUnitId,
    (row) => row.businessUnitId,
    (row) => `${String(row.businessUnitId)}:${String(row.productTeamServiceId)}`,
    (row) => `${String(row.businessUnitId)}:${String(row.productTeamServiceId)}`,
  );
}

export function createVerifyReport(outcome: VerifyOutcome, now: Date): VerifyReport {
  return { kind: REPORT_KIND, report: "verify", createdAt: now.toISOString(), ...outcome };
}
