import type { Config } from "../config.js";
import { UnsafeDatabaseOperationError, assertLocalDatabase } from "../repositories/index.js";

/**
 * Which database the load and verify scripts may use. A local one is fine, as
 * for db:seed. Any other, such as RDS in AWS, has to be named on purpose with
 * --database-host, and must be the host DATABASE_URL points at, so a run can't
 * reach a database by accident. Messages never include DATABASE_URL, which
 * holds the password.
 */

export class MigrationTargetError extends Error {
  override readonly name = "MigrationTargetError";
}

/** Query parameters that can point a connection somewhere other than the URL's host. */
const HOST_OVERRIDE_PARAMS = ["host", "hostaddr"];

const HOW_TO_NAME_A_HOST =
  "To use a database on another host, name that host with --database-host (or MIGRATION_DATABASE_HOST)";

export function assertMigrationDatabase(
  config: Pick<Config, "nodeEnv" | "databaseUrl">,
  databaseHost: string | undefined,
): void {
  let url: URL;
  try {
    url = new URL(config.databaseUrl);
  } catch {
    throw new MigrationTargetError("DATABASE_URL is not a valid address");
  }
  for (const param of HOST_OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new MigrationTargetError(
        `refusing a DATABASE_URL with a "${param}" query parameter; put the host in the URL itself`,
      );
    }
  }

  if (databaseHost === undefined) {
    try {
      assertLocalDatabase(config);
    } catch (error) {
      if (error instanceof UnsafeDatabaseOperationError) {
        throw new MigrationTargetError(`${error.message}. ${HOW_TO_NAME_A_HOST}`);
      }
      throw error;
    }
    return;
  }

  if (url.hostname.toLowerCase() !== databaseHost.toLowerCase()) {
    throw new MigrationTargetError(
      "the host given with --database-host (or MIGRATION_DATABASE_HOST) doesn't match the host in DATABASE_URL",
    );
  }
}
