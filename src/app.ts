import compression from "compression";
import express, { type Express, type Response } from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import type { Logger } from "./lib/logger.js";
import { createRenderer } from "./lib/render.js";
import { cspNonce } from "./middleware/csp-nonce.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { assetsRouter } from "./routes/assets.js";
import { healthRouter } from "./routes/health.js";
import { pagesRouter } from "./routes/pages.js";
import { testOnlyRouter } from "./routes/test-only.js";

export interface AppDependencies {
  config: Config;
  logger: Logger;
}

/** Builds the Express app. Does not start listening. */
export function createApp({ config, logger }: AppDependencies): Express {
  const app = express();
  const renderer = createRenderer({ noCache: config.nodeEnv === "development" });

  app.disable("x-powered-by");
  app.use(requestId(logger));
  app.use(requestLogger());
  app.use(cspNonce());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
          // Locally and in tests the app is served over plain HTTP, where
          // upgrading asset requests to HTTPS would break the page.
          upgradeInsecureRequests: config.nodeEnv === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(compression());

  app.use(assetsRouter());
  app.use(healthRouter(config.version));
  app.use(pagesRouter(renderer));
  if (config.nodeEnv === "test") {
    app.use(testOnlyRouter());
  }

  app.use(notFoundHandler());
  app.use(errorHandler(renderer));

  return app;
}
