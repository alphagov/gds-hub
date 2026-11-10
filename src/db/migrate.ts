import { migrate } from "drizzle-orm/node-postgres/migrator";
import { MIGRATIONS_DIR } from "../paths.js";
import type { Database } from "./client.js";

/**
 * Applies any migrations in drizzle/ that haven't run yet. Drizzle records
 * applied migrations in drizzle.__drizzle_migrations.
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
