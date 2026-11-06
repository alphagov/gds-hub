import compression from "compression";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import type { Logger } from "./lib/logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { healthRouter } from "./routes/health.js";

export interface AppDependencies {
  config: Config;
  logger: Logger;
}

/** Builds the Express app. Does not start listening. */
export function createApp({ config, logger }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestId(logger));
  app.use(requestLogger());
  app.use(helmet());
  app.use(compression());

  app.use(healthRouter(config.version));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(errorHandler());

  return app;
}
