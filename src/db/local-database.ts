import type { Config } from "../config.js";

/**
 * The check db:reset, db:seed and the data migration make before changing
 * data: is this a local database? It is on its own, with no imports beyond
 * types, so the migration can use it (through src/repositories) without the
 * web server loading the code that drops and seeds databases.
 */

/** Hosts a local or CI database runs on. "db" is the docker compose service. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "db"]);

/**
 * Query parameters that can point a connection somewhere other than the
 * URL's host. node-postgres lets ?host= override the host in the URL.
 */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"];

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
