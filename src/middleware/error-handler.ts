import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { HttpError } from "../lib/http-error.js";
import type { Renderer } from "../lib/render.js";
import { ERROR_PAGES, type ErrorStatus } from "../site-map.js";
import type { ErrorViewModel, ViewName } from "../view-models.js";

const ERROR_TEMPLATES = {
  403: "errors/403.njk",
  404: "errors/404.njk",
  500: "errors/500.njk",
} as const satisfies Record<ErrorStatus, ViewName>;

/** Turns any request that no route handled into a 404. */
export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(new HttpError(404));
  };
}

function errorPage(status: ErrorStatus, requestId: string): ErrorViewModel {
  const { title } = ERROR_PAGES[status];
  return status === 500 ? { title, requestId } : { title };
}

/** Last resort when the error page itself can't be rendered. */
function sendPlainTextError(res: Response): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res
    .status(500)
    .type("text/plain")
    .send(`${ERROR_PAGES[500].title}. Request ID: ${res.locals.requestId}`);
}

/**
 * Renders the GOV.UK error page for an HttpError, and the 500 page for
 * anything else. Unexpected errors are logged; 403s and 404s are already
 * recorded by the request logger.
 *
 * If the response has already started, the page can't be sent, so the
 * connection is closed instead of leaving the client waiting. If the error
 * page itself fails to render, a plain-text 500 is sent instead.
 */
export function errorHandler(renderer: Renderer): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    const status: ErrorStatus = err instanceof HttpError ? err.status : 500;
    if (status === 500) {
      res.locals.logger.error("unhandled error", { err });
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }

    res.set("Cache-Control", "no-store");
    const page = errorPage(status, res.locals.requestId);
    renderer.render(res, ERROR_TEMPLATES[status], page, status).catch((renderError: unknown) => {
      res.locals.logger.error("failed to render error page", { err: renderError });
      sendPlainTextError(res);
    });
  };
}
