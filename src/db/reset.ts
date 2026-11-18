import { and, eq, getTableName, like, ne, sql, type SQL } from "drizzle-orm";
import type { Database, Transaction } from "./client.js";
import { entityTypeOf } from "./entity-types.js";
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "./migrate.js";
import {
  auditAction,
  auditLog,
  contentStatus,
  engineeringOrBusinessTool,
  migrationStatus,
  pageType,
} from "./schema/index.js";
import { SEED_ACTOR } from "./seed/seed-data.js";
import { APP_RELATION_NAMES, APP_TABLES, APP_VIEW_NAMES, firstNonEmptyTable } from "./tables.js";
import { UnsafeDatabaseOperationError } from "./local-database.js";

// Kept here too, for the scripts and tests that import them from reset.
export { UnsafeDatabaseOperationError, assertLocalDatabase } from "./local-database.js";

/** The schema the app's migrations create everything in. */
const APP_SCHEMA = "public";

/** Functions the app's migrations create (drizzle/0002_audit_log_append_only.sql). */
const APP_FUNCTION_NAMES: readonly string[] = ["audit_log_reject_change"];

/** Enums the app's migrations create. */
const APP_ENUM_NAMES: readonly string[] = [
  auditAction,
  contentStatus,
  engineeringOrBusinessTool,
  migrationStatus,
  pageType,
].map((appEnum) => appEnum.enumName);

/** SQLSTATE when DROP ... RESTRICT refuses because something else depends on the object. */
const DEPENDENT_OBJECTS_STILL_EXIST = "2BP01";

const HOW_TO_START_AGAIN =
  "To start again with a local docker compose database, run `docker compose down -v`.";

interface Relation {
  readonly schema: string;
  readonly name: string;
}

/**
 * Drops every table, view, function and enum the app's migrations create, and
 * the migration history, if the database only holds things db:reset is allowed
 * to throw away. Call assertLocalDatabase first. This checks what is in the
 * database, not where it is, so a tunnel to a real database on localhost is
 * still refused. It allows:
 *
 * - an empty database (no tables or views at all)
 * - a migrated database with no data
 * - a seeded development database, including edits made in it, as long as
 *   every row has a record of being created in audit_log
 *
 * It refuses, and drops nothing, if the database has tables or views this app
 * doesn't create (in the public or migration history schemas), data that was
 * imported, data in a database that was never seeded, rows with no audit
 * record of being created, or anything else that depends on the objects it
 * would drop.
 *
 * The check and the drop run in one transaction. The app's tables are locked
 * before their contents are checked and stay locked until the drop commits, so
 * nothing (an import, say) can be written in between. Objects are dropped by
 * name without CASCADE, so PostgreSQL refuses if anything else depends on them,
 * and anything else in the database is left alone.
 */
export async function dropAppObjects(db: Database): Promise<void> {
  await db.transaction(
    async (tx) => {
      const relations = await findAppRelations(tx);
      if (relations.length > 0) {
        // Waits for writers already in progress to commit, then keeps new ones
        // out. Each later query sees what they committed, because READ
        // COMMITTED takes a new snapshot per statement.
        await tx.execute(sql`LOCK TABLE ${qualifiedList(relations)} IN ACCESS EXCLUSIVE MODE`);
      }
      await assertResettable(tx, relations);
      try {
        await dropFound(tx, relations);
      } catch (error) {
        const detail = dependentObjectsDetail(error);
        if (detail === undefined) throw error;
        throw new UnsafeDatabaseOperationError(
          `refusing to reset a database where other objects depend on what this app creates (${detail})`,
        );
      }
    },
    // Explicit, so a server default of REPEATABLE READ can't make the checks
    // read a snapshot taken before the lock was granted.
    { isolationLevel: "read committed" },
  );
}

/**
 * The tables and views in the app's schema and the migration history schema.
 * Throws if any of them aren't ones this app creates.
 */
async function findAppRelations(tx: Transaction): Promise<Relation[]> {
  const result = await tx.execute<{ schema: string; name: string }>(sql`
    SELECT n.nspname AS schema, c.relname AS name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN (${APP_SCHEMA}, ${MIGRATIONS_SCHEMA})
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY n.nspname, c.relname`);
  const relations = result.rows.map(({ schema, name }) => ({ schema, name }));

  const unknown = relations
    .filter(({ schema, name }) =>
      schema === APP_SCHEMA ? !APP_RELATION_NAMES.has(name) : name !== MIGRATIONS_TABLE,
    )
    .map(({ schema, name }) => `${schema}.${name}`);
  if (unknown.length > 0) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with tables this app doesn't create (${unknown.join(", ")})`,
    );
  }
  return relations;
}

/**
 * Throws unless the database was seeded, nothing was imported, and every row
 * in the app's tables has a record of being created (by the seed or by an
 * edit made since) in audit_log.
 */
async function assertResettable(tx: Transaction, relations: readonly Relation[]): Promise<void> {
  const names = relations.filter(({ schema }) => schema === APP_SCHEMA).map(({ name }) => name);
  // Nothing the migrations create, so no data to check. There may be a migration history.
  if (names.length === 0) return;
  // Only the app's tables the database has: one migrated before a newer
  // migration (such as a new table) is still reset, then migrated again.
  const existing: ReadonlySet<string> = new Set(names);

  if (!names.includes("audit_log")) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database without an audit_log table. ${HOW_TO_START_AGAIN}`,
    );
  }

  const otherSystemEntries = await tx.$count(
    auditLog,
    and(like(auditLog.actorSubject, "system:%"), ne(auditLog.actorSubject, SEED_ACTOR.subject)),
  );
  if (otherSystemEntries > 0) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with imported data. ${HOW_TO_START_AGAIN}`,
    );
  }

  const seedEntries = await tx.$count(auditLog, eq(auditLog.actorSubject, SEED_ACTOR.subject));
  if (seedEntries === 0) {
    const nonEmpty = await firstNonEmptyTable(tx, existing);
    if (nonEmpty !== undefined) {
      throw new UnsafeDatabaseOperationError(
        `refusing to reset a database with data that wasn't created by the seed (in ${nonEmpty}). ${HOW_TO_START_AGAIN}`,
      );
    }
    return;
  }

  // Seed entries only show the database was seeded at some point. Each row
  // still needs its own record, so data written without one isn't dropped.
  const unrecorded = await firstTableWithUnrecordedRows(tx, existing);
  if (unrecorded !== undefined) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with rows that have no audit record of being created (in ${unrecorded}). ${HOW_TO_START_AGAIN}`,
    );
  }
}

/**
 * The name of the first audited table with a row that has no "create" entry
 * in audit_log, or undefined if every row has one. Only the tables in
 * `existing` are checked.
 */
async function firstTableWithUnrecordedRows(
  tx: Transaction,
  existing: ReadonlySet<string>,
): Promise<string | undefined> {
  for (const table of APP_TABLES) {
    if (table === auditLog || !existing.has(getTableName(table))) continue;
    const result = await tx.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM ${table} AS r
        WHERE NOT EXISTS (
          SELECT 1 FROM ${auditLog} AS a
          WHERE a.entity_type = ${entityTypeOf(table)}
            AND a.entity_id = r.id
            AND a.action = 'create'
        )
      ) AS found`);
    if (result.rows[0]?.found) return getTableName(table);
  }
  return undefined;
}

/**
 * Drops the relations that were found and checked, then the app's functions,
 * enums and migration history schema. Every DROP is RESTRICT.
 */
async function dropFound(tx: Transaction, relations: readonly Relation[]): Promise<void> {
  const isView = ({ schema, name }: Relation) =>
    schema === APP_SCHEMA && APP_VIEW_NAMES.includes(name);
  const views = relations.filter(isView);
  const tables = relations.filter((relation) => !isView(relation));

  if (views.length > 0) await tx.execute(sql`DROP VIEW ${qualifiedList(views)} RESTRICT`);
  if (tables.length > 0) await tx.execute(sql`DROP TABLE ${qualifiedList(tables)} RESTRICT`);
  const functions = APP_FUNCTION_NAMES.map((name) => sql`${qualified(APP_SCHEMA, name)}()`);
  await tx.execute(sql`DROP FUNCTION IF EXISTS ${sql.join(functions, sql`, `)} RESTRICT`);
  const enums = APP_ENUM_NAMES.map((name) => qualified(APP_SCHEMA, name));
  await tx.execute(sql`DROP TYPE IF EXISTS ${sql.join(enums, sql`, `)} RESTRICT`);
  await tx.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)} RESTRICT`);
}

function qualified(schema: string, name: string): SQL {
  return sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
}

function qualifiedList(relations: readonly Relation[]): SQL {
  return sql.join(
    relations.map(({ schema, name }) => qualified(schema, name)),
    sql`, `,
  );
}

/**
 * PostgreSQL's list of dependent objects if a DROP ... RESTRICT failed because
 * something else depends on what it drops, otherwise undefined.
 */
function dependentObjectsDetail(error: unknown): string | undefined {
  // Drizzle wraps driver errors, so walk the cause chain.
  let current: unknown = error;
  while (current instanceof Error) {
    if ("code" in current && current.code === DEPENDENT_OBJECTS_STILL_EXIST) {
      return "detail" in current && typeof current.detail === "string"
        ? current.detail.replaceAll("\n", "; ")
        : "no details given";
    }
    current = current.cause;
  }
  return undefined;
}
