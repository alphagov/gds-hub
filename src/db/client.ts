import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

/** The handle Database.transaction() passes to its callback. Runs on one connection. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseConnection {
  readonly db: Database;
  /** Closes every connection in the pool. Call once when shutting down. */
  close(): Promise<void>;
}

export interface ConnectOptions {
  /**
   * Called when an idle connection in the pool fails, for example because the
   * database restarted. The pool replaces the connection. Without this, Node
   * stops the process, which is right for the one-off scripts in src/db but
   * not for the server.
   */
  readonly onIdleError?: (error: Error) => void;
  /** How long to wait for a connection before failing. Unset waits forever. */
  readonly connectionTimeoutMs?: number;
  /** The longest a statement may run before the database cancels it. Unset means no limit. */
  readonly statementTimeoutMs?: number;
}

/**
 * Opens a connection pool. Only repositories (and the scripts in src/db)
 * should call this or import from src/db.
 */
export function connect(databaseUrl: string, options: ConnectOptions = {}): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: options.connectionTimeoutMs,
    statement_timeout: options.statementTimeoutMs,
  });
  const { onIdleError } = options;
  if (onIdleError !== undefined) {
    pool.on("error", (error) => {
      onIdleError(error);
    });
  }
  const db = drizzle({ client: pool, schema });
  return {
    db,
    close: () => pool.end(),
  };
}
