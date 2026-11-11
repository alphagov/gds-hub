import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { Transaction } from "../db/client.js";
import type { EntityType } from "../db/entity-types.js";
import { auditLog } from "../db/schema/index.js";
import type { Actor } from "../services/audit/actor.js";
import { toRepositoryError } from "./errors.js";
import type { Executor } from "./executor.js";

export type AuditAction = (typeof auditLog.action.enumValues)[number];

type AuditLogRow = typeof auditLog.$inferSelect;

/** One recorded change. `before` and `after` are the full record, keyed by field name. */
export interface AuditEntry {
  readonly id: number;
  readonly entityType: EntityType;
  readonly entityId: number;
  readonly action: AuditAction;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly changedFields: readonly string[];
  /** The editor's email in the MVP, or a system actor such as "system:data_migration". */
  readonly actorName: string;
  readonly actorSubject: string;
  readonly requestId: string | null;
  readonly changeSummary: string | null;
  readonly createdAt: Date;
}

/** Reads the audit log. Entries are only ever added by the repositories' writes. */
export interface AuditLogRepository {
  /** Changes to one record, newest first. */
  historyFor(entityType: EntityType, entityId: number, limit: number): Promise<AuditEntry[]>;
  /** Changes to any record, newest first, optionally only for some types of record. */
  recent(limit: number, entityTypes?: readonly EntityType[]): Promise<AuditEntry[]>;
}

/** Writes made by the repositories: create, update and delete. */
export type AuditedAction = Extract<AuditAction, "create" | "update" | "delete">;

export interface NewAuditEntry {
  readonly entityType: EntityType;
  readonly entityId: number;
  readonly action: AuditedAction;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly changedFields: readonly string[];
  readonly actor: Actor;
  readonly changeSummary?: string | undefined;
  /**
   * When the change was made: the time the write took the record's lock, so
   * entries for one record are in the order the changes were committed. The
   * record's updated_at is set to the same value.
   */
  readonly changedAt: Date;
}

/**
 * Adds an audit entry. Only call this inside the transaction that made the
 * change, so the change and its entry are committed or rolled back together.
 *
 * `before` and `after` are stored with the code's (camelCase) field names.
 * Dates become ISO 8601 strings in the jsonb.
 */
export async function recordAuditEntry(tx: Transaction, entry: NewAuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before === null ? null : { ...entry.before },
    after: entry.after === null ? null : { ...entry.after },
    changedFields: [...entry.changedFields],
    // No identity provider in the MVP: the email is both the name and the subject.
    actorName: entry.actor.email,
    actorSubject: entry.actor.email,
    requestId: entry.actor.requestId ?? null,
    changeSummary: entry.changeSummary ?? null,
    createdAt: entry.changedAt,
  });
}

function toAuditEntry(row: AuditLogRow): AuditEntry {
  return {
    ...row,
    // entity_type is only ever written from ENTITY_TYPE_BY_TABLE.
    entityType: row.entityType as EntityType,
  };
}

const NEWEST_FIRST = [desc(auditLog.createdAt), desc(auditLog.id)] as const;

export function createAuditLogRepository(executor: Executor): AuditLogRepository {
  const read = async (where: SQL | undefined, limit: number): Promise<AuditEntry[]> => {
    try {
      const rows = await executor
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(...NEWEST_FIRST)
        .limit(limit);
      return rows.map(toAuditEntry);
    } catch (error) {
      throw toRepositoryError(error, "audit_entry", "read");
    }
  };

  return {
    historyFor: (entityType, entityId, limit) =>
      read(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)), limit),

    recent: (limit, entityTypes) => {
      if (entityTypes === undefined) return read(undefined, limit);
      if (entityTypes.length === 0) return Promise.resolve([]);
      return read(inArray(auditLog.entityType, [...entityTypes]), limit);
    },
  };
}
