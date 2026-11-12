import compression from "compression";
import express, { type Express, type Response } from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import type { Logger } from "./lib/logger.js";
import { createRenderer } from "./lib/render.js";
import { cspNonce } from "./middleware/csp-nonce.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { redirectOnNotFound } from "./middleware/redirect-on-not-found.js";
import { requestId } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import { assetsRouter } from "./routes/assets.js";
import { catalogueRouter } from "./routes/catalogue.js";
import { healthRouter } from "./routes/health.js";
import { pagesRouter } from "./routes/pages.js";
import { testOnlyRouter } from "./routes/test-only.js";
import type { CatalogueService } from "./services/catalogue/catalogue-service.js";
import type { RedirectService } from "./services/redirects/redirect-service.js";

export interface AppDependencies {
  config: Config;
  logger: Logger;
  /** What the read pages show. server.ts builds it from the repositories; tests pass a fake. */
  catalogue: CatalogueService;
  /** Where old addresses now go. server.ts builds it from the repositories; tests pass a fake. */
  redirects: RedirectService;
}

/** Builds the Express app. Does not start listening. */
export function createApp({ config, logger, catalogue, redirects }: AppDependencies): Express {
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
  app.use(catalogueRouter(renderer, catalogue));
  app.use(pagesRouter(renderer, catalogue));
  if (config.nodeEnv === "test") {
    app.use(testOnlyRouter());
  }

  app.use(notFoundHandler());
  app.use(redirectOnNotFound(redirects));
  app.use(errorHandler(renderer));

  return app;
}
