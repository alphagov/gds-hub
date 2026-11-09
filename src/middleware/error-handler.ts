import type { ErrorRequestHandler } from "express";

/**
 * Logs unhandled errors and returns a 500 with the request ID. If the
 * response has already started, a 500 can't be sent, so the connection is
 * closed instead of leaving the client waiting. This is what Express's
 * default handler does, without its unstructured console output.
 */
export function errorHandler(): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    res.locals.logger.error("unhandled error", { err });
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).json({
      error: "Internal server error",
      requestId: res.locals.requestId,
    });
  };
}
