import { ConfigError, loadConfig, type Config } from "../../config.js";
import { createJsonLogger, type Logger } from "../../lib/logger.js";
import { connect, type Database } from "../client.js";

export interface ScriptContext {
  readonly config: Config;
  readonly logger: Logger;
  readonly db: Database;
}

/**
 * Runs a database command-line script: loads config, opens a connection,
 * logs failures and always closes the pool. Exits non-zero on failure.
 */
export async function runScript(
  name: string,
  task: (context: ScriptContext) => Promise<void>,
): Promise<void> {
  const bootLogger = createJsonLogger({ level: "info", base: { script: name } });

  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    bootLogger.error("invalid configuration", {
      issues: error instanceof ConfigError ? error.issues : undefined,
      err: error instanceof ConfigError ? undefined : error,
    });
    process.exitCode = 1;
    return;
  }

  const logger = createJsonLogger({ level: config.logLevel, base: { script: name } });
  const connection = connect(config.databaseUrl);
  try {
    await task({ config, logger, db: connection.db });
  } catch (error) {
    logger.error(`${name} failed`, { err: error });
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
}
