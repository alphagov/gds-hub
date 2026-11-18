import { eq, inArray, sql } from "drizzle-orm";
import type { EntityType } from "../db/entity-types.js";
import {
  auditLog,
  businessUnitProductTeamServices,
  businessUnits,
  capabilities,
  capabilityTools,
  contracts,
  instances,
  ownershipLevels,
  pages,
  productTeamServiceInstances,
  productTeamServices,
  redirects,
  tools,
} from "../db/schema/index.js";
import { SEED_ACTOR } from "../db/seed/seed-data.js";
import { RepositoryError, toRepositoryError } from "./errors.js";
import { isTransaction, type Executor } from "./executor.js";

/**
 * Reads for the data migration from the current Hub: what is already in the
 * database, and the lock that stops two runs overlapping. The migration writes
 * through the table repositories, so every change is audited.
 */

/**
 * The advisory lock the migration holds while it runs. Any fixed number works,
 * as long as nothing else in the app uses it.
 */
const MIGRATION_LOCK_KEY = 581_903_455;

/** The record types the migration loads, and the links between them. */
export const MIGRATION_ENTITY_TYPES = [
  "ownership_level",
  "tool",
  "contract",
  "instance",
  "capability",
  "product_team_service",
  "business_unit",
  "page",
  "redirect",
  "capability_tool",
  "product_team_service_instance",
  "business_unit_product_team_service",
] as const satisfies readonly EntityType[];

export type MigrationEntityType = (typeof MIGRATION_ENTITY_TYPES)[number];

/** Every row the migration might write, as it is now. */
export interface MigrationSnapshot {
  readonly ownershipLevels: readonly (typeof ownershipLevels.$inferSelect)[];
  readonly tools: readonly (typeof tools.$inferSelect)[];
  readonly contracts: readonly (typeof contracts.$inferSelect)[];
  readonly instances: readonly (typeof instances.$inferSelect)[];
  readonly capabilities: readonly (typeof capabilities.$inferSelect)[];
  readonly productTeamServices: readonly (typeof productTeamServices.$inferSelect)[];
  readonly businessUnits: readonly (typeof businessUnits.$inferSelect)[];
  readonly pages: readonly (typeof pages.$inferSelect)[];
  readonly redirects: readonly (typeof redirects.$inferSelect)[];
  readonly capabilityTools: readonly (typeof capabilityTools.$inferSelect)[];
  readonly productTeamServiceInstances: readonly (typeof productTeamServiceInstances.$inferSelect)[];
  readonly businessUnitProductTeamServices: readonly (typeof businessUnitProductTeamServices.$inferSelect)[];
  /**
   * Who made the latest change to each of those rows, keyed by
   * `${entityType}:${id}`. A row with no audit entries isn't listed.
   */
  readonly lastActors: ReadonlyMap<string, string>;
}

export interface MigrationRepository {
  /**
   * Takes the migration's lock until the open transaction ends. Returns false,
   * without waiting, if another run holds it. Only works inside transaction().
   */
  tryLockRun(): Promise<boolean>;
  /** Whether the synthetic seed has written to this database. */
  hasSeedData(): Promise<boolean>;
  /** Every row the migration might write, and who last changed each one. */
  snapshot(): Promise<MigrationSnapshot>;
}

/** The key for a row in MigrationSnapshot.lastActors. */
export function lastActorKey(entityType: MigrationEntityType, id: number): string {
  return `${entityType}:${String(id)}`;
}

export function createMigrationRepository(executor: Executor): MigrationRepository {
  const read = async <R>(operation: () => Promise<R>): Promise<R> => {
    try {
      return await operation();
    } catch (error) {
      throw toRepositoryError(error, "migration_run", "read");
    }
  };

  return {
    async tryLockRun() {
      if (!isTransaction(executor)) {
        throw new RepositoryError("failed", "migration_run", { operation: "read" });
      }
      return await read(async () => {
        const result = await executor.execute<{ locked: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY}) AS locked`,
        );
        return result.rows[0]?.locked === true;
      });
    },

    hasSeedData: () =>
      read(
        async () =>
          (await executor.$count(auditLog, eq(auditLog.actorSubject, SEED_ACTOR.subject))) > 0,
      ),

    snapshot: () =>
      read(async () => {
        // The latest entry for each record: entries for one record are in
        // the order their changes were committed (see recordAuditEntry).
        const latest = await executor
          .selectDistinctOn([auditLog.entityType, auditLog.entityId], {
            entityType: auditLog.entityType,
            entityId: auditLog.entityId,
            actorSubject: auditLog.actorSubject,
          })
          .from(auditLog)
          .where(inArray(auditLog.entityType, [...MIGRATION_ENTITY_TYPES]))
          .orderBy(
            auditLog.entityType,
            auditLog.entityId,
            sql`${auditLog.createdAt} DESC`,
            sql`${auditLog.id} DESC`,
          );
        return {
          ownershipLevels: await executor.select().from(ownershipLevels),
          tools: await executor.select().from(tools),
          contracts: await executor.select().from(contracts),
          instances: await executor.select().from(instances),
          capabilities: await executor.select().from(capabilities),
          productTeamServices: await executor.select().from(productTeamServices),
          businessUnits: await executor.select().from(businessUnits),
          pages: await executor.select().from(pages),
          redirects: await executor.select().from(redirects),
          capabilityTools: await executor.select().from(capabilityTools),
          productTeamServiceInstances: await executor.select().from(productTeamServiceInstances),
          businessUnitProductTeamServices: await executor
            .select()
            .from(businessUnitProductTeamServices),
          lastActors: new Map(
            latest.map((row) => [`${row.entityType}:${String(row.entityId)}`, row.actorSubject]),
          ),
        };
      }),
  };
}
