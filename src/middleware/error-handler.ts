import { STATUS_CODES } from "node:http";
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

interface ClientError {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The 4xx status (and any headers) carried by an error from Express or its
 * file-serving middleware, such as the 416 that res.sendFile passes on for an
 * unsatisfiable Range header. Undefined for anything else.
 */
function clientErrorFrom(err: unknown): ClientError | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const { status, statusCode, headers } = err as Record<string, unknown>;
  const value = typeof status === "number" ? status : statusCode;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 400 || value > 499) {
    return undefined;
  }

  const safeHeaders: Record<string, string> = {};
  if (typeof headers === "object" && headers !== null) {
    for (const [name, headerValue] of Object.entries(headers)) {
      if (typeof headerValue === "string") safeHeaders[name] = headerValue;
    }
  }
  return { status: value, headers: safeHeaders };
}

function isErrorStatus(status: number): status is ErrorStatus {
  return Object.hasOwn(ERROR_TEMPLATES, status);
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
 * anything unexpected. Client errors (4xx) from other middleware keep their
 * status: 403 and 404 get their page, and the rest a short plain-text
 * response. Only unexpected errors are logged; client errors are already
 * recorded by the request logger.
 *
 * If the response has already started, the page can't be sent, so the
 * connection is closed instead of leaving the client waiting. If the error
 * page itself fails to render, a plain-text 500 is sent instead.
 */
export function errorHandler(renderer: Renderer): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    const clientError = err instanceof HttpError ? undefined : clientErrorFrom(err);
    const status: number = err instanceof HttpError ? err.status : (clientError?.status ?? 500);

    if (status === 500) {
      res.locals.logger.error("unhandled error", { err });
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }

    res.set("Cache-Control", "no-store");

    if (!isErrorStatus(status)) {
      res
        .status(status)
        .set(clientError?.headers ?? {})
        .type("text/plain")
        .send(STATUS_CODES[status] ?? "Client error");
      return;
    }

    const page = errorPage(status, res.locals.requestId);
    renderer.render(res, ERROR_TEMPLATES[status], page, status).catch((renderError: unknown) => {
      res.locals.logger.error("failed to render error page", { err: renderError });
      sendPlainTextError(res);
    });
  };
}
