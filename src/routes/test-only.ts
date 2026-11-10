import { Router } from "express";
import { HttpError } from "../lib/http-error.js";
import { TEST_ROUTES } from "../site-map.js";

/**
 * Routes that let end-to-end tests reach the 403 and 500 pages. Only mounted
 * when NODE_ENV is "test".
 */
export function testOnlyRouter(): Router {
  const router = Router();

  router.get(TEST_ROUTES.forbidden, (_req, _res, next) => {
    next(new HttpError(403));
  });

  router.get(TEST_ROUTES.error, (_req, _res, next) => {
    next(new Error("deliberate error from the test-only route"));
  });

  return router;
}
