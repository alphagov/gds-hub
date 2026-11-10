import { and, eq, like, ne, sql } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Database } from "./client.js";
import { auditLog } from "./schema/index.js";
import { SEED_ACTOR } from "./seed/seed-data.js";
import { APP_RELATION_NAMES, firstNonEmptyTable } from "./tables.js";

/** Hosts a local or CI database runs on. "db" is the docker compose service. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

/**
 * Query parameters that can point a connection somewhere other than the
 * URL's host. node-postgres lets ?host= override the host in the URL.
 */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"];

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

/**
 * Throws unless the database only holds things db:reset is allowed to throw
 * away. This checks what is in the database, not where it is, so a tunnel to
 * a real database on localhost is still refused. It allows:
 *
 * - an empty database (no tables or views at all)
 * - a migrated database with no data
 * - a seeded development database, including any edits made in it
 *
 * It refuses a database that has tables or views this app doesn't create,
 * data that was imported, or data that wasn't created by the seed.
 */
export async function assertResettable(db: Database): Promise<void> {
  const relations = await db.execute<{ name: string }>(sql`
    SELECT c.relname AS name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`);
  const names = relations.rows.map((row) => row.name);
  if (names.length === 0) return;

  const unknown = names.filter((name) => !APP_RELATION_NAMES.has(name)).sort();
  if (unknown.length > 0) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with tables this app doesn't create (${unknown.join(", ")})`,
    );
  }
  if (!names.includes("audit_log")) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database without an audit_log table. ${HOW_TO_START_AGAIN}`,
    );
  }

  const otherSystemEntries = await db.$count(
    auditLog,
    and(like(auditLog.actorSubject, "system:%"), ne(auditLog.actorSubject, SEED_ACTOR.subject)),
  );
  if (otherSystemEntries > 0) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with imported data. ${HOW_TO_START_AGAIN}`,
    );
  }

  const seedEntries = await db.$count(auditLog, eq(auditLog.actorSubject, SEED_ACTOR.subject));
  if (seedEntries > 0) return;

  const nonEmpty = await firstNonEmptyTable(db);
  if (nonEmpty !== undefined) {
    throw new UnsafeDatabaseOperationError(
      `refusing to reset a database with data that wasn't created by the seed (in ${nonEmpty}). ${HOW_TO_START_AGAIN}`,
    );
  }
}

/**
 * Drops every table, view, enum and the migration history, leaving an empty
 * public schema. Call assertLocalDatabase and assertResettable first.
 */
export async function dropEverything(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await tx.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await tx.execute(sql`CREATE SCHEMA public`);
  });
}
