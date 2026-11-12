import { createApp } from "./app.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createJsonLogger } from "./lib/logger.js";
import { connectRepositories } from "./repositories/index.js";
import { createCatalogueService } from "./services/catalogue/catalogue-service.js";
import { createRedirectService } from "./services/redirects/redirect-service.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Read pages query the database on every request. These stop a slow or
// unreachable database from holding requests (and pool connections) open
// indefinitely: the request gets the 500 page instead.
const DATABASE_CONNECTION_TIMEOUT_MS = 5_000;
const DATABASE_STATEMENT_TIMEOUT_MS = 10_000;

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    const bootLogger = createJsonLogger({ level: "error" });
    if (error instanceof ConfigError) {
      bootLogger.error("invalid configuration, refusing to start", {
        issues: error.issues,
      });
    } else {
      bootLogger.error("failed to load configuration", { err: error });
    }
    process.exit(1);
  }
}

const config = readConfig();
const logger = createJsonLogger({
  level: config.logLevel,
  base: { service: "gds-hub", version: config.version },
});

// The pool connects lazily, so a database that isn't up yet doesn't stop the
// app starting: read pages fail with the 500 page until it is reachable.
const database = connectRepositories(config.databaseUrl, {
  connectionTimeoutMs: DATABASE_CONNECTION_TIMEOUT_MS,
  statementTimeoutMs: DATABASE_STATEMENT_TIMEOUT_MS,
  onIdleError: (err) => {
    logger.error("idle database connection failed", { err });
  },
});
const catalogue = createCatalogueService(database.repositories);
const redirects = createRedirectService(database.repositories);

const server = createApp({ config, logger, catalogue, redirects }).listen(
  config.port,
  (err?: Error) => {
    if (err) {
      logger.error("failed to start server", { err });
      process.exit(1);
    }
    logger.info("server listening", { port: config.port, env: config.nodeEnv });
  },
);

function shutdown(signal: NodeJS.Signals): void {
  logger.info("shutting down", { signal });
  const timer = setTimeout(() => {
    logger.error("shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  server.close((err) => {
    if (err) {
      logger.error("error during shutdown", { err });
      process.exit(1);
    }
    database.close().then(
      () => {
        process.exit(0);
      },
      (closeError: unknown) => {
        logger.error("error closing the database pool", { err: closeError });
        process.exit(1);
      },
    );
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
