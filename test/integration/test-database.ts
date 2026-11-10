import { randomBytes } from "node:crypto";
import pg from "pg";
import { connect, type Database } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { assertLocalDatabase } from "../../src/db/reset.js";

export const FOREIGN_KEY_VIOLATION = "23503";
/** Raised when ON DELETE RESTRICT blocks a delete. */
export const RESTRICT_VIOLATION = "23001";
export const CHECK_VIOLATION = "23514";
export const UNIQUE_VIOLATION = "23505";
/** Raised by RAISE EXCEPTION, for example by the audit_log append-only triggers. */
export const RAISE_EXCEPTION = "P0001";

export interface TestDatabase {
  readonly db: Database;
  drop(): Promise<void>;
}

async function adminQuery(serverUrl: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/**
 * Creates a new, empty database with a random name on the DATABASE_URL
 * server. It must be a local server, as for db:reset. Call drop() when
 * finished.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) {
    throw new Error(
      "DATABASE_URL is not set. Put it in .env (see .env.example) or the environment.",
    );
  }
  assertLocalDatabase({ nodeEnv: "test", databaseUrl: serverUrl });

  const name = `gdshub_test_${randomBytes(6).toString("hex")}`;
  await adminQuery(serverUrl, `CREATE DATABASE "${name}"`);

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const connection = connect(url.toString());

  return {
    db: connection.db,
    drop: async () => {
      await connection.close();
      await adminQuery(serverUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    },
  };
}

/** Like createTestDatabase, with every migration applied. */
export async function createMigratedTestDatabase(): Promise<TestDatabase> {
  const testDatabase = await createTestDatabase();
  try {
    await runMigrations(testDatabase.db);
  } catch (error) {
    await testDatabase.drop();
    throw error;
  }
  return testDatabase;
}

/** The Postgres error code (SQLSTATE) from a failed query, or undefined if it succeeded. */
export async function postgresErrorCode(
  query: () => PromiseLike<unknown>,
): Promise<string | undefined> {
  try {
    await query();
  } catch (error) {
    // Drizzle wraps driver errors, so walk the cause chain.
    let current: unknown = error;
    while (current instanceof Error) {
      if ("code" in current && typeof current.code === "string") return current.code;
      current = current.cause;
    }
    throw error;
  }
  return undefined;
}
