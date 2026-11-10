import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  readonly db: Database;
  /** Closes every connection in the pool. Call once when shutting down. */
  close(): Promise<void>;
}

/**
 * Opens a connection pool. Only repositories (and the scripts in src/db)
 * should call this or import from src/db.
 */
export function connect(databaseUrl: string): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle({ client: pool, schema });
  return {
    db,
    close: () => pool.end(),
  };
}
