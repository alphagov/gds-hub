import { createApp } from "./app.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createJsonLogger } from "./lib/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

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

const server = createApp({ config, logger }).listen(config.port, () => {
  logger.info("server listening", { port: config.port, env: config.nodeEnv });
});

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
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
