import { and, eq, like, ne, sql, type SQL } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Database, Transaction } from "./client.js";
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
import { APP_RELATION_NAMES, APP_VIEW_NAMES, firstNonEmptyTable } from "./tables.js";

/** Hosts a local or CI database runs on. "db" is the docker compose service. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

/**
 * Query parameters that can point a connection somewhere other than the
 * URL's host. node-postgres lets ?host= override the host in the URL.
 */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"];

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

export class UnsafeDatabaseOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDatabaseOperationError";
  }
}

/**
 * Throws unless the database is safe to wipe or fill with synthetic data:
 * not in production, and on a local host.
 */
export function assertLocalDatabase(config: Pick<Config, "nodeEnv" | "databaseUrl">): void {
  if (config.nodeEnv === "production") {
    throw new UnsafeDatabaseOperationError("refusing to change data when NODE_ENV is production");
  }
  const url = new URL(config.databaseUrl);
  for (const param of HOST_OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new UnsafeDatabaseOperationError(
        `refusing a DATABASE_URL with a "${param}" query parameter; put the host in the URL itself`,
      );
    }
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new UnsafeDatabaseOperationError(
      `refusing to change data on a non-local database host (${url.hostname})`,
    );
  }
}

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
 * - a seeded development database, including any edits made in it
 *
 * It refuses, and drops nothing, if the database has tables or views this app
 * doesn't create (in the public or migration history schemas), data that was
 * imported, data that wasn't created by the seed, or anything else that
 * depends on the objects it would drop.
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

/** Throws unless the app's tables hold nothing but seed data and edits made since. */
async function assertResettable(tx: Transaction, relations: readonly Relation[]): Promise<void> {
  const names = relations.filter(({ schema }) => schema === APP_SCHEMA).map(({ name }) => name);
  // Nothing the migrations create, so no data to check. There may be a migration history.
  if (names.length === 0) return;

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
  if (seedEntries > 0) return;

  const nonEmpty = await firstNonEmptyTable(tx);
  if (nonEmpty !== undefined) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with data that wasn't created by the seed (in ${nonEmpty}). ${HOW_TO_START_AGAIN}`,
    );
  }
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
