import type {
  AuditAction,
  AuditEntry,
  EntityType,
  Repositories,
} from "../../repositories/index.js";

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 500;
export const DEFAULT_RECENT_CHANGES_LIMIT = 20;
export const MAX_RECENT_CHANGES_LIMIT = 100;

export interface HistoryOptions {
  /** How many entries to return. Defaults to 50, and is capped at 500. */
  readonly limit?: number | undefined;
}

export interface RecentChangesOptions {
  /** How many entries to return. Defaults to 20, and is capped at 100. */
  readonly limit?: number | undefined;
  /** Only changes to these types of record. An empty list returns nothing. */
  readonly entityTypes?: readonly EntityType[] | undefined;
}

/** When a record last changed, and who changed it. */
export interface LastUpdated {
  readonly at: Date;
  /** The editor's email, or a system actor such as "system:data_migration". */
  readonly by: string;
  readonly action: AuditAction;
}

export interface AuditService {
  /** Every recorded change to one record, newest first. Kept after the record is deleted. */
  historyFor(
    entityType: EntityType,
    entityId: number,
    options?: HistoryOptions,
  ): Promise<AuditEntry[]>;
  /** The latest changes to any record, newest first. */
  recentChanges(options?: RecentChangesOptions): Promise<AuditEntry[]>;
  /**
   * The latest recorded change to a record, or undefined if it has none.
   * Updates that changed nothing aren't recorded, so they don't count.
   */
  lastUpdated(entityType: EntityType, entityId: number): Promise<LastUpdated | undefined>;
}

function checkedLimit(limit: number | undefined, fallback: number, maximum: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("limit must be a whole number of at least 1");
  }
  return Math.min(limit, maximum);
}

export function createAuditService(repositories: Pick<Repositories, "auditLog">): AuditService {
  const { auditLog } = repositories;

  return {
    async historyFor(entityType, entityId, options = {}) {
      const limit = checkedLimit(options.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
      return await auditLog.historyFor(entityType, entityId, limit);
    },

    async recentChanges(options = {}) {
      const limit = checkedLimit(
        options.limit,
        DEFAULT_RECENT_CHANGES_LIMIT,
        MAX_RECENT_CHANGES_LIMIT,
      );
      return await auditLog.recent(limit, options.entityTypes);
    },

    async lastUpdated(entityType, entityId) {
      const [latest] = await auditLog.historyFor(entityType, entityId, 1);
      if (latest === undefined) return undefined;
      return { at: latest.createdAt, by: latest.actorName, action: latest.action };
    },
  };
}
