import { migrate } from "drizzle-orm/node-postgres/migrator";
import { MIGRATIONS_DIR } from "../paths.js";
import type { Database } from "./client.js";

/**
 * Where drizzle records which migrations have run. These are drizzle's
 * defaults, named here so db:reset knows exactly what to drop.
 */
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/** Applies any migrations in drizzle/ that haven't run yet. */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, {
    migrationsFolder: MIGRATIONS_DIR,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
  });
}
