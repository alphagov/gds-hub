import {
  lastActorKey,
  type MigrationSnapshot,
  type TransactionRepositories,
  type WriteOptions,
} from "../repositories/index.js";
import { DATA_MIGRATION_ACTOR_EMAIL, systemActor, type Actor } from "../services/audit/actor.js";
import type { MigrationPlan } from "./inventory.js";
import {
  createLoadMapping,
  type CapabilityToolRow,
  type IdLookup,
  type LoadMapping,
  type TeamInstanceRow,
  type UnitTeamRow,
} from "./load-mapping.js";
import type { MigrationRecord, TargetEntity } from "./records.js";

/**
 * Loads a migration plan into the database through the repositories, as
 * system:data_migration, so every write is audited with the run's ID.
 *
 * - The whole run is one transaction, holding a lock so two runs can't
 *   overlap. If anything fails, nothing is kept.
 * - A dry run does exactly the same writes, then rolls them back.
 * - Records are matched by key (pages by slug, redirects by old path, a
 *   contract through its tool's placeholder instance). An update that
 *   changes nothing writes nothing, so a second run changes nothing.
 * - A record an editor has changed since the migration last wrote it is
 *   skipped, never overwritten.
 * - Nothing is deleted, except links between migrated records that the
 *   migration made and the data no longer has.
 */

export type LoadAction = "create" | "update" | "unchanged" | "skipped";

export interface RecordOutcome {
  readonly entity: TargetEntity;
  readonly key: string;
  readonly action: LoadAction;
  /** The fields an update changed. Empty for anything else. */
  readonly changedFields: readonly string[];
  /** Why a record was skipped. */
  readonly reason?: string;
}

export type LinkTable =
  "capability_tool" | "product_team_service_instance" | "business_unit_product_team_service";

export interface LinkOutcome {
  readonly table: LinkTable;
  readonly added: number;
  readonly removed: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface RecordReference {
  readonly entity: TargetEntity;
  readonly key: string;
}

export interface LoadOutcome {
  readonly runId: string;
  /** False for a dry run, whose writes were rolled back. */
  readonly applied: boolean;
  /** Every record in the plan, in the order it was loaded. */
  readonly records: readonly RecordOutcome[];
  readonly links: readonly LinkOutcome[];
  /** Records in the database that the plan doesn't have. They are never deleted. */
  readonly onlyInDatabase: readonly RecordReference[];
}

export type LoadFailure = "plan_failed" | "seeded_database" | "run_in_progress";

/** The load was refused before anything was written. */
export class MigrationLoadError extends Error {
  override readonly name = "MigrationLoadError";

  constructor(
    readonly reason: LoadFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface LoadOptions {
  /** Keep the writes. Otherwise they are rolled back at the end. */
  readonly apply: boolean;
  /** Recorded as the request ID of every audit entry the run makes. */
  readonly runId: string;
}

const CHANGE_SUMMARY: WriteOptions = { changeSummary: "Migrated from the current Hub" };

const SKIPPED_REASON = "an editor has changed it since the migration last wrote it";

/** Carries a dry run's outcome out of its transaction, which throwing rolls back. */
class DryRunFinished extends Error {
  constructor(readonly outcome: LoadOutcome) {
    super("dry run finished");
  }
}

/** The writes the loader makes. Each repository is typed for its own table (see writerFor). */
interface RecordWriter {
  create(values: object, actor: Actor, options?: WriteOptions): Promise<{ readonly id: number }>;
  update(
    id: number,
    changes: object,
    actor: Actor,
    options?: WriteOptions,
  ): Promise<{ readonly changedFields: readonly string[] }>;
  remove(id: number, actor: Actor, options?: WriteOptions): Promise<unknown>;
}

/**
 * The repository for a record type. The mapping gives each table's own
 * columns by name, which the repositories check, so the loader can treat
 * them alike. This is the one place their table types are set aside.
 */
function writerFor(tx: TransactionRepositories, entity: TargetEntity | LinkTable): RecordWriter {
  const repositories: Readonly<Record<TargetEntity | LinkTable, unknown>> = {
    ownership_level: tx.ownershipLevels,
    tool: tx.tools,
    contract: tx.contracts,
    instance: tx.instances,
    capability: tx.capabilities,
    product_team_service: tx.productTeamServices,
    business_unit: tx.businessUnits,
    page: tx.pages,
    redirect: tx.redirects,
    capability_tool: tx.capabilityTools,
    product_team_service_instance: tx.productTeamServiceInstances,
    business_unit_product_team_service: tx.businessUnitProductTeamServices,
  };
  return repositories[entity] as RecordWriter;
}

/** A record's identity across types, for lookups. */
export const recordId = (entity: TargetEntity, key: string) => `${entity}:${key}`;

/** The IDs of the records already in the database, by type and key. */
export function existingIds(
  snapshot: MigrationSnapshot,
  records: readonly MigrationRecord[],
): Map<string, number> {
  const ids = new Map<string, number>();
  const keyed: [TargetEntity, readonly { readonly id: number; readonly key: string }[]][] = [
    ["ownership_level", snapshot.ownershipLevels],
    ["tool", snapshot.tools],
    ["instance", snapshot.instances],
    ["capability", snapshot.capabilities],
    ["product_team_service", snapshot.productTeamServices],
    ["business_unit", snapshot.businessUnits],
  ];
  for (const [entity, rows] of keyed) {
    for (const row of rows) ids.set(recordId(entity, row.key), row.id);
  }
  for (const page of snapshot.pages) ids.set(recordId("page", page.slug), page.id);
  for (const redirect of snapshot.redirects) {
    ids.set(recordId("redirect", redirect.oldPath), redirect.id);
  }

  // A contract has no key: it is the one its tool's placeholder instance links to.
  const contractIds = new Set(snapshot.contracts.map((contract) => contract.id));
  for (const record of records) {
    if (record.targetEntity !== "instance" || record.fields.isPlaceholder !== true) continue;
    const contractKey = record.fields.contractKey;
    if (typeof contractKey !== "string") continue;
    const placeholder = snapshot.instances.find((instance) => instance.key === record.key);
    const contractId = placeholder?.contractId;
    if (contractId !== undefined && contractId !== null && contractIds.has(contractId)) {
      ids.set(recordId("contract", contractKey), contractId);
    }
  }
  return ids;
}

/** Records in the database whose key the plan doesn't have. Contracts have no key, so aren't listed. */
export function recordsOnlyInDatabase(
  snapshot: MigrationSnapshot,
  records: readonly MigrationRecord[],
): RecordReference[] {
  const inPlan = new Set(records.map((record) => recordId(record.targetEntity, record.key)));
  const keyed: [TargetEntity, readonly string[]][] = [
    ["ownership_level", snapshot.ownershipLevels.map((row) => row.key)],
    ["tool", snapshot.tools.map((row) => row.key)],
    ["instance", snapshot.instances.map((row) => row.key)],
    ["capability", snapshot.capabilities.map((row) => row.key)],
    ["product_team_service", snapshot.productTeamServices.map((row) => row.key)],
    ["business_unit", snapshot.businessUnits.map((row) => row.key)],
    ["page", snapshot.pages.map((row) => row.slug)],
    ["redirect", snapshot.redirects.map((row) => row.oldPath)],
  ];
  return keyed.flatMap(([entity, keys]) =>
    [...keys]
      .sort()
      .filter((key) => !inPlan.has(recordId(entity, key)))
      .map((key) => ({ entity, key })),
  );
}

interface LinkSpec<Row> {
  readonly table: LinkTable;
  /** The migrated records whose links the migration manages. */
  readonly parentIds: ReadonlySet<number>;
  readonly parentOf: (row: Row) => number;
  readonly pairOf: (row: Row) => string;
  readonly desired: readonly Row[];
  readonly existing: readonly (Row & { readonly id: number })[];
  /** The fields that can change without it being a different link. */
  readonly changes?: (want: Row, have: Row) => object | undefined;
}

/**
 * Makes a join table's rows for the migrated records match the plan. A link
 * an editor made or changed is left alone and not counted.
 */
async function syncLinks<Row extends object>(
  tx: TransactionRepositories,
  spec: LinkSpec<Row>,
  lastActors: ReadonlyMap<string, string>,
  actor: Actor,
): Promise<LinkOutcome> {
  const writer = writerFor(tx, spec.table);
  const ours = (id: number) =>
    lastActors.get(lastActorKey(spec.table, id)) === DATA_MIGRATION_ACTOR_EMAIL;
  const existing = new Map(
    spec.existing
      .filter((row) => spec.parentIds.has(spec.parentOf(row)))
      .map((row) => [spec.pairOf(row), row]),
  );
  const outcome = { table: spec.table, added: 0, removed: 0, updated: 0, unchanged: 0 };

  const wanted = new Set<string>();
  for (const want of spec.desired) {
    if (!spec.parentIds.has(spec.parentOf(want))) continue;
    const pair = spec.pairOf(want);
    wanted.add(pair);
    const have = existing.get(pair);
    if (have === undefined) {
      await writer.create(want, actor, CHANGE_SUMMARY);
      outcome.added += 1;
      continue;
    }
    const changes = spec.changes?.(want, have);
    if (changes === undefined) {
      outcome.unchanged += 1;
    } else if (ours(have.id)) {
      await writer.update(have.id, changes, actor, CHANGE_SUMMARY);
      outcome.updated += 1;
    }
  }
  for (const [pair, have] of existing) {
    if (wanted.has(pair) || !ours(have.id)) continue;
    await writer.remove(have.id, actor, CHANGE_SUMMARY);
    outcome.removed += 1;
  }
  return outcome;
}

async function loadInTransaction(
  tx: TransactionRepositories,
  plan: MigrationPlan,
  mapping: LoadMapping,
  options: LoadOptions,
  actor: Actor,
): Promise<LoadOutcome> {
  if (!(await tx.migration.tryLockRun())) {
    throw new MigrationLoadError("run_in_progress", "another migration run is in progress");
  }
  if (await tx.migration.hasSeedData()) {
    throw new MigrationLoadError(
      "seeded_database",
      "the database has synthetic seed data, which mustn't be mixed with migrated data. Load into an empty, migrated database (see docs/migration.md)",
    );
  }

  const snapshot = await tx.migration.snapshot();
  const ids = existingIds(snapshot, plan.records);
  const idOf: IdLookup = (entity, key) => ids.get(recordId(entity, key));
  const skipped = new Set<string>();
  const records: RecordOutcome[] = [];

  for (const record of mapping.loadOrder()) {
    const { targetEntity: entity, key } = record;
    const writer = writerFor(tx, entity);
    const existingId = idOf(entity, key);

    if (existingId === undefined) {
      const created = await writer.create(
        mapping.columnValues(record, idOf),
        actor,
        CHANGE_SUMMARY,
      );
      ids.set(recordId(entity, key), created.id);
      records.push({ entity, key, action: "create", changedFields: [] });
      continue;
    }

    const lastActor = snapshot.lastActors.get(lastActorKey(entity, existingId));
    if (lastActor !== DATA_MIGRATION_ACTOR_EMAIL) {
      skipped.add(recordId(entity, key));
      records.push({ entity, key, action: "skipped", changedFields: [], reason: SKIPPED_REASON });
      continue;
    }

    const { changedFields } = await writer.update(
      existingId,
      mapping.columnValues(record, idOf),
      actor,
      CHANGE_SUMMARY,
    );
    records.push({
      entity,
      key,
      action: changedFields.length > 0 ? "update" : "unchanged",
      changedFields: [...changedFields],
    });
  }

  // Links, now every record has an ID. Only those of migrated records that
  // weren't skipped are managed.
  const managed = (entity: TargetEntity): ReadonlySet<number> =>
    new Set(
      plan.records
        .filter((r) => r.targetEntity === entity && !skipped.has(recordId(entity, r.key)))
        .map((r) => idOf(entity, r.key))
        .filter((id): id is number => id !== undefined),
    );
  const desired = mapping.linkRows(idOf);

  const links: LinkOutcome[] = [
    await syncLinks<CapabilityToolRow>(
      tx,
      {
        table: "capability_tool",
        parentIds: managed("capability"),
        parentOf: (row) => row.capabilityId,
        pairOf: (row) => `${String(row.capabilityId)}:${String(row.toolId)}`,
        desired: desired.capabilityTools,
        existing: snapshot.capabilityTools.map((row) => ({
          id: row.id,
          capabilityId: row.capabilityId,
          toolId: row.toolId,
          position: row.position ?? -1,
        })),
        changes: (want, have) =>
          want.position === have.position ? undefined : { position: want.position },
      },
      snapshot.lastActors,
      actor,
    ),
    await syncLinks<TeamInstanceRow>(
      tx,
      {
        table: "product_team_service_instance",
        parentIds: managed("product_team_service"),
        parentOf: (row) => row.productTeamServiceId,
        pairOf: (row) => `${String(row.productTeamServiceId)}:${String(row.instanceId)}`,
        desired: desired.productTeamServiceInstances,
        existing: snapshot.productTeamServiceInstances.map((row) => ({
          id: row.id,
          productTeamServiceId: row.productTeamServiceId,
          instanceId: row.instanceId,
        })),
      },
      snapshot.lastActors,
      actor,
    ),
    await syncLinks<UnitTeamRow>(
      tx,
      {
        table: "business_unit_product_team_service",
        parentIds: managed("business_unit"),
        parentOf: (row) => row.businessUnitId,
        pairOf: (row) => `${String(row.businessUnitId)}:${String(row.productTeamServiceId)}`,
        desired: desired.businessUnitProductTeamServices,
        existing: snapshot.businessUnitProductTeamServices.map((row) => ({
          id: row.id,
          businessUnitId: row.businessUnitId,
          productTeamServiceId: row.productTeamServiceId,
        })),
      },
      snapshot.lastActors,
      actor,
    ),
  ];

  return {
    runId: options.runId,
    applied: options.apply,
    records,
    links,
    onlyInDatabase: recordsOnlyInDatabase(snapshot, plan.records),
  };
}

/**
 * Loads the plan, or on a dry run works out what loading it would do. Throws
 * MigrationLoadError, having written nothing, if the plan has validation
 * issues, the database has seed data or another run is in progress.
 */
export async function loadPlan(
  plan: MigrationPlan,
  repositories: Pick<TransactionRepositories, "transaction">,
  options: LoadOptions,
): Promise<LoadOutcome> {
  if (plan.issues.length > 0) {
    throw new MigrationLoadError(
      "plan_failed",
      `the inventory found ${String(plan.issues.length)} validation issues, so nothing was loaded. Run migrate:inventory to see them`,
    );
  }
  const actor = systemActor("data_migration", { requestId: options.runId });
  const mapping = createLoadMapping(plan.records);

  try {
    return await repositories.transaction(async (tx) => {
      const outcome = await loadInTransaction(tx, plan, mapping, options, actor);
      if (!options.apply) throw new DryRunFinished(outcome);
      return outcome;
    });
  } catch (error) {
    if (error instanceof DryRunFinished) return error.outcome;
    throw error;
  }
}
