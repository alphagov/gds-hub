import type { AssetReference, InventoryItem, ItemKind, MigrationPlan } from "./inventory.js";
import {
  TARGET_ENTITIES,
  type MigrationWarning,
  type TargetEntity,
  type ValidationIssue,
} from "./records.js";
import type { ReportTarget } from "./storage/types.js";

/**
 * Reports for the developer and content owners. They hold paths, keys,
 * counts and warnings only, never content, but they still go to the
 * git-ignored report folder.
 */

/** Marks a file as a migration report, so the commit check can spot one. */
export const REPORT_KIND = "gds-hub-migration-report";

/** The kinds of input, each with its own pass or fail. */
export const SUMMARY_GROUPS = ["content", "yaml", "listing", "redirect", "unknown"] as const;
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

const GROUP_OF_KIND: Readonly<Record<ItemKind, SummaryGroup>> = {
  content_page: "content",
  data_file: "yaml",
  record_page: "yaml",
  listing_page: "listing",
  redirect_page: "redirect",
  unknown_page: "unknown",
};

/** The kind of input a record or issue belongs to. */
export function groupOfEntity(entity: TargetEntity | undefined): SummaryGroup {
  if (entity === "page") return "content";
  if (entity === "redirect") return "redirect";
  return "yaml";
}

export interface GroupSummary {
  readonly group: SummaryGroup;
  readonly items: number;
  readonly migrated: number;
  readonly skipped: number;
  readonly manualReview: number;
  readonly records: number;
  readonly issues: number;
  readonly passed: boolean;
}

export interface RecordWarnings {
  readonly sourcePath: string;
  readonly targetEntity: TargetEntity;
  readonly key: string;
  readonly warnings: readonly MigrationWarning[];
}

export interface InventoryReport {
  readonly kind: typeof REPORT_KIND;
  readonly report: "inventory";
  readonly createdAt: string;
  readonly passed: boolean;
  readonly summary: readonly GroupSummary[];
  readonly recordCounts: Readonly<Record<TargetEntity, number>>;
  readonly items: readonly InventoryItem[];
  /** Warnings on records from the YAML. Page warnings are on their items. */
  readonly recordWarnings: readonly RecordWarnings[];
  readonly issues: readonly ValidationIssue[];
  readonly assets: readonly AssetReference[];
}

export function createInventoryReport(plan: MigrationPlan, now: Date): InventoryReport {
  const summary = SUMMARY_GROUPS.map((group): GroupSummary => {
    const items = plan.items.filter((i) => GROUP_OF_KIND[i.kind] === group);
    const issues = plan.issues.filter(
      (issue) => groupOfEntity(issue.targetEntity) === group,
    ).length;
    return {
      group,
      items: items.length,
      migrated: items.filter((i) => i.status === "migrated").length,
      skipped: items.filter((i) => i.status === "skipped").length,
      manualReview: items.filter((i) => i.status === "manual_review").length,
      records: plan.records.filter((r) => groupOfEntity(r.targetEntity) === group).length,
      issues,
      passed: issues === 0,
    };
  });

  const recordCounts = Object.fromEntries(
    TARGET_ENTITIES.map((entity) => [
      entity,
      plan.records.filter((r) => r.targetEntity === entity).length,
    ]),
  ) as Record<TargetEntity, number>;

  return {
    kind: REPORT_KIND,
    report: "inventory",
    createdAt: now.toISOString(),
    passed: summary.every((row) => row.passed),
    summary,
    recordCounts,
    items: plan.items,
    recordWarnings: plan.records
      .filter((r) => r.targetEntity !== "page" && r.warnings.length > 0)
      .map((r) => ({
        sourcePath: r.sourcePath,
        targetEntity: r.targetEntity,
        key: r.key,
        warnings: r.warnings,
      })),
    issues: plan.issues,
    assets: plan.assets,
  };
}

/**
 * Writes a report as JSON to the report folder or S3 prefix, never replacing
 * an earlier one. Returns where it went.
 */
export async function writeReport(
  target: ReportTarget,
  report: { readonly report: string; readonly createdAt: string },
): Promise<string> {
  const stamp = report.createdAt.replace(/[:.]/g, "-");
  return await target.write(
    `${report.report}-${stamp}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
