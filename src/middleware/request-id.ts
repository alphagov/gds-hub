import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import type { Logger } from "../lib/logger.js";

export const REQUEST_ID_HEADER = "x-request-id";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reuses a well-formed incoming request ID (for tracing across services)
 * or generates a new one, echoes it on the response and attaches a
 * request-scoped child logger to res.locals.
 */
export function requestId(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const id = incoming !== undefined && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

    res.locals.requestId = id;
    res.locals.logger = logger.child({ requestId: id });
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
