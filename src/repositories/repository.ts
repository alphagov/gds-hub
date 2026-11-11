import { asc, eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Transaction } from "../db/client.js";
import {
  entityTypeOf,
  type ENTITY_TYPE_BY_TABLE,
  type AuditedTableName,
  type EntityType,
} from "../db/entity-types.js";
import { assertValidActor, type Actor } from "../services/audit/actor.js";
import { changedFields, valuesEqual } from "../services/audit/changes.js";
import { recordAuditEntry } from "./audit-log-repository.js";
import { RepositoryError, toRepositoryError } from "./errors.js";
import { runInTransaction, type Executor } from "./executor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A table the repositories can manage: it has an id and both timestamps. */
export type AuditedTable = PgTable & {
  readonly id: PgColumn;
  readonly createdAt: PgColumn;
  readonly updatedAt: PgColumn;
};

/** The audit_log entity_type for a table, for example "tool" for tools. */
export type EntityTypeOfTable<T extends PgTable> = T["_"]["name"] extends infer Name extends
  AuditedTableName
  ? (typeof ENTITY_TYPE_BY_TABLE)[Name]
  : never;

/** Columns the repository sets itself. Callers can't supply them. */
type ManagedField = "id" | "createdAt" | "updatedAt";

/** A record as read from the table. */
export type RecordOf<T extends AuditedTable> = T["$inferSelect"];

/** The values for a new record. */
export type NewRecord<T extends AuditedTable> = Omit<T["$inferInsert"], ManagedField>;

/** The fields to change in an update. Fields left out keep their value. */
export type RecordChanges<T extends AuditedTable> = Partial<NewRecord<T>>;

export interface WriteOptions {
  /** A short description of the change, stored in the audit entry. */
  readonly changeSummary?: string | undefined;
}

export interface ListOptions {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface UpdateResult<R> {
  /** The record after the update, or unchanged if nothing changed. */
  readonly record: R;
  /** The fields that changed. Empty if nothing changed, in which case nothing was written. */
  readonly changedFields: readonly string[];
}

export interface BaseRepository<T extends AuditedTable> {
  readonly entityType: EntityTypeOfTable<T>;
  /** Every record, in name (or title) order, then by id. */
  list(options?: ListOptions): Promise<RecordOf<T>[]>;
  getById(id: number): Promise<RecordOf<T> | undefined>;
  /** Adds a record and its "create" audit entry. */
  create(values: NewRecord<T>, actor: Actor, options?: WriteOptions): Promise<RecordOf<T>>;
  /**
   * Changes a record and adds an "update" audit entry. If nothing would
   * change, nothing is written: no audit entry, and updated_at stays the same.
   * Throws RepositoryError("not_found") if there is no such record.
   */
  update(
    id: number,
    changes: RecordChanges<T>,
    actor: Actor,
    options?: WriteOptions,
  ): Promise<UpdateResult<RecordOf<T>>>;
  /**
   * Deletes a record and adds a "delete" audit entry. Returns the deleted
   * record. Throws RepositoryError("not_found") if there is no such record,
   * or "in_use" if another record still links to it.
   */
  remove(id: number, actor: Actor, options?: WriteOptions): Promise<RecordOf<T>>;
}

export interface SlugLookup<T extends AuditedTable> {
  /** Finds a record by its URL identifier: its slug, or its key if the table has no slug. */
  getBySlug(slug: string): Promise<RecordOf<T> | undefined>;
}

type HasColumn<T extends PgTable, Name extends string> = Name extends keyof T["_"]["columns"]
  ? true
  : false;

type HasUrlIdentifier<T extends PgTable> =
  HasColumn<T, "slug"> extends true ? true : HasColumn<T, "key">;

/** A table's repository. getBySlug exists only on tables with a slug or key column. */
export type Repository<T extends AuditedTable> = BaseRepository<T> &
  (HasUrlIdentifier<T> extends true ? SlugLookup<T> : unknown);

/** Binds a table's repository to the pool or to an open transaction. */
export type RepositoryFactory<T extends AuditedTable> = (executor: Executor) => Repository<T>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

// Drizzle can't infer row types for a table chosen at runtime, so the
// implementation works with plain rows. createRepository restores the table's
// own types in one place.

type Row = Record<string, unknown>;

interface TableAccess {
  readonly entityType: EntityType;
  list(options?: ListOptions): Promise<Row[]>;
  getById(id: number): Promise<Row | undefined>;
  getBySlug?: (slug: string) => Promise<Row | undefined>;
  create(values: Readonly<Row>, actor: Actor, options?: WriteOptions): Promise<Row>;
  update(
    id: number,
    changes: Readonly<Row>,
    actor: Actor,
    options?: WriteOptions,
  ): Promise<UpdateResult<Row>>;
  remove(id: number, actor: Actor, options?: WriteOptions): Promise<Row>;
}

interface TableDetails {
  readonly table: AuditedTable;
  readonly entityType: EntityType;
  /** Columns a caller may write: every column except the managed ones. */
  readonly writableFields: ReadonlySet<string>;
  readonly urlIdentifier: PgColumn | undefined;
  readonly listOrder: readonly PgColumn[];
}

const MANAGED_FIELDS: ReadonlySet<string> = new Set<ManagedField>(["id", "createdAt", "updatedAt"]);

/** Thrown inside a write's transaction to undo an update that turned out to change nothing. */
class NothingChanged extends Error {
  constructor(readonly record: Row) {
    super("nothing changed");
  }
}

function idOf(row: Readonly<Row>): number {
  const { id } = row;
  if (typeof id !== "number") throw new Error("the database returned a row with no id");
  return id;
}

function firstRow(rows: readonly Row[], what: string): Row {
  const [row] = rows;
  if (row === undefined) throw new Error(`the database returned no row for the ${what}`);
  return row;
}

/** The caller's values, without managed fields, unknown fields or undefined values. */
function writableValues(details: TableDetails, values: Readonly<Row>): Row {
  const result: Row = {};
  for (const [field, value] of Object.entries(values)) {
    if (value !== undefined && details.writableFields.has(field)) result[field] = value;
  }
  return result;
}

function checkedCount(
  value: number | undefined,
  name: string,
  minimum: number,
): number | undefined {
  if (value !== undefined && (!Number.isInteger(value) || value < minimum)) {
    throw new RangeError(`${name} must be a whole number of at least ${minimum}`);
  }
  return value;
}

function bind(details: TableDetails, executor: Executor): TableAccess {
  const { table, entityType, urlIdentifier } = details;

  const read = async <R>(operation: () => Promise<R>): Promise<R> => {
    try {
      return await operation();
    } catch (error) {
      throw toRepositoryError(error, entityType, "read");
    }
  };

  /** The current row, locked until the transaction ends so the audit "before" is accurate. */
  const lockRow = async (tx: Transaction, id: number): Promise<Row> => {
    const [row] = await tx.select().from(table).where(eq(table.id, id)).for("update");
    if (row === undefined) throw new RepositoryError("not_found", entityType);
    return row;
  };

  const access: TableAccess = {
    entityType,

    list: async (options = {}) => {
      const limit = checkedCount(options.limit, "limit", 1);
      const offset = checkedCount(options.offset, "offset", 0);
      return await read(async () => {
        let query = executor
          .select()
          .from(table)
          .orderBy(...details.listOrder.map((column) => asc(column)))
          .$dynamic();
        if (limit !== undefined) query = query.limit(limit);
        if (offset !== undefined) query = query.offset(offset);
        return await query;
      });
    },

    getById: (id) =>
      read(async () => {
        const [row] = await executor.select().from(table).where(eq(table.id, id));
        return row;
      }),

    create: async (values, actor, options = {}) => {
      assertValidActor(actor);
      const input = writableValues(details, values);
      try {
        return await runInTransaction(executor, async (tx) => {
          const after = firstRow(await tx.insert(table).values(input).returning(), "new record");
          await recordAuditEntry(tx, {
            entityType,
            entityId: idOf(after),
            action: "create",
            before: null,
            after,
            changedFields: Object.keys(after),
            actor,
            changeSummary: options.changeSummary,
          });
          return after;
        });
      } catch (error) {
        throw toRepositoryError(error, entityType, "create");
      }
    },

    update: async (id, changes, actor, options = {}) => {
      assertValidActor(actor);
      const input = writableValues(details, changes);
      try {
        return await runInTransaction(executor, async (tx) => {
          const before = await lockRow(tx, id);
          const requested = Object.keys(input).filter(
            (field) => !valuesEqual(before[field], input[field]),
          );
          if (requested.length === 0) return { record: before, changedFields: [] };

          // now() is the transaction's start time, so updated_at matches the
          // audit entry's created_at.
          const after = firstRow(
            await tx
              .update(table)
              .set({ ...input, updatedAt: sql`now()` })
              .where(eq(table.id, id))
              .returning(),
            "updated record",
          );
          // Compare what the database stored, in case it normalised a value
          // back to what was already there.
          const fields = changedFields(before, after, ["updatedAt"]);
          if (fields.length === 0) throw new NothingChanged(before);

          await recordAuditEntry(tx, {
            entityType,
            entityId: id,
            action: "update",
            before,
            after,
            changedFields: fields,
            actor,
            changeSummary: options.changeSummary,
          });
          return { record: after, changedFields: fields };
        });
      } catch (error) {
        if (error instanceof NothingChanged) return { record: error.record, changedFields: [] };
        throw toRepositoryError(error, entityType, "update");
      }
    },

    remove: async (id, actor, options = {}) => {
      assertValidActor(actor);
      try {
        return await runInTransaction(executor, async (tx) => {
          const before = await lockRow(tx, id);
          const deleted = firstRow(
            await tx.delete(table).where(eq(table.id, id)).returning(),
            "removed record",
          );
          await recordAuditEntry(tx, {
            entityType,
            entityId: id,
            action: "delete",
            before,
            after: null,
            changedFields: Object.keys(before),
            actor,
            changeSummary: options.changeSummary,
          });
          return deleted;
        });
      } catch (error) {
        throw toRepositoryError(error, entityType, "remove");
      }
    },
  };

  if (urlIdentifier === undefined) return access;
  return {
    ...access,
    getBySlug: (slug) =>
      read(async () => {
        const [row] = await executor.select().from(table).where(eq(urlIdentifier, slug));
        return row;
      }),
  };
}

/**
 * Makes the repository for a table. `entityType` must be the table's audit
 * entity type (from ENTITY_TYPE_BY_TABLE). This is checked when compiling
 * and again here.
 *
 * Every write runs in its own transaction (a savepoint inside an open one):
 * it locks and reads the current row, makes the change, sets updated_at and
 * adds the audit entry. If any step fails, the whole write is rolled back.
 */
export function createRepository<T extends AuditedTable>(
  table: T,
  entityType: EntityTypeOfTable<T>,
): RepositoryFactory<T> {
  const requested: string = entityType;
  const expected = entityTypeOf(table);
  if (requested !== expected) {
    throw new Error(
      `entity type "${requested}" does not match table "${getTableName(table)}" (expected "${expected}")`,
    );
  }

  const audited: AuditedTable = table;
  const columns: Readonly<Record<string, PgColumn>> = getTableColumns(audited);
  const nameColumn = columns.name ?? columns.title;
  const details: TableDetails = {
    table: audited,
    entityType: expected,
    writableFields: new Set(Object.keys(columns).filter((field) => !MANAGED_FIELDS.has(field))),
    urlIdentifier: columns.slug ?? columns.key,
    listOrder: nameColumn === undefined ? [audited.id] : [nameColumn, audited.id],
  };

  // The one place the table's own types are restored (see "Implementation").
  return (executor) => bind(details, executor) as unknown as Repository<T>;
}
