import { randomBytes } from "node:crypto";
import type { LinkOutcome, LoadAction, LoadOutcome, RecordReference } from "./loader.js";
import { TARGET_ENTITIES, type TargetEntity } from "./records.js";
import { REPORT_KIND, SUMMARY_GROUPS, groupOfEntity, type SummaryGroup } from "./report.js";

/**
 * The report of a load or dry run. Like every migration report it holds
 * keys, field names and counts, never values or content.
 */

export interface LoadCounts {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skipped: number;
}

export interface LoadGroupSummary extends LoadCounts {
  readonly group: SummaryGroup;
  readonly records: number;
}

export interface LoadChange {
  readonly entity: TargetEntity;
  readonly key: string;
  readonly action: Exclude<LoadAction, "unchanged" | "skipped">;
  readonly changedFields: readonly string[];
}

export interface SkippedRecord extends RecordReference {
  readonly reason: string;
}

export interface LoadReport {
  readonly kind: typeof REPORT_KIND;
  readonly report: "load";
  readonly createdAt: string;
  readonly runId: string;
  /** False for a dry run, which wrote nothing. */
  readonly applied: boolean;
  /** False if any record had to be skipped, so someone needs to look. */
  readonly passed: boolean;
  readonly summary: readonly LoadGroupSummary[];
  readonly entities: Readonly<Record<TargetEntity, LoadCounts>>;
  readonly changes: readonly LoadChange[];
  readonly skipped: readonly SkippedRecord[];
  readonly links: readonly LinkOutcome[];
  readonly onlyInDatabase: readonly RecordReference[];
}

const COUNTED: Readonly<Record<LoadAction, keyof LoadCounts>> = {
  create: "created",
  update: "updated",
  unchanged: "unchanged",
  skipped: "skipped",
};

function countActions(actions: readonly LoadAction[]): LoadCounts {
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const action of actions) counts[COUNTED[action]] += 1;
  return counts;
}

export function createLoadReport(outcome: LoadOutcome, now: Date): LoadReport {
  const { records } = outcome;
  const summary = SUMMARY_GROUPS.map((group): LoadGroupSummary => {
    const inGroup = records.filter((record) => groupOfEntity(record.entity) === group);
    return { group, records: inGroup.length, ...countActions(inGroup.map((r) => r.action)) };
  });
  const entities = Object.fromEntries(
    TARGET_ENTITIES.map((entity) => [
      entity,
      countActions(records.filter((r) => r.entity === entity).map((r) => r.action)),
    ]),
  ) as Record<TargetEntity, LoadCounts>;

  const changes = records.flatMap((record): LoadChange[] =>
    record.action === "create" || record.action === "update"
      ? [
          {
            entity: record.entity,
            key: record.key,
            action: record.action,
            changedFields: record.changedFields,
          },
        ]
      : [],
  );
  const skipped = records.flatMap((record): SkippedRecord[] =>
    record.action === "skipped"
      ? [{ entity: record.entity, key: record.key, reason: record.reason ?? "skipped" }]
      : [],
  );

  return {
    kind: REPORT_KIND,
    report: "load",
    createdAt: now.toISOString(),
    runId: outcome.runId,
    applied: outcome.applied,
    passed: skipped.length === 0,
    summary,
    entities,
    changes,
    skipped,
    links: outcome.links,
    onlyInDatabase: outcome.onlyInDatabase,
  };
}

/**
 * A new run's ID, such as migration-20261112T101500Z-a1b2c3: when it started,
 * and a random part so two runs never share one. Every audit entry the run
 * makes records it as the request ID.
 */
export function newRunId(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `migration-${stamp}-${randomBytes(3).toString("hex")}`;
}
