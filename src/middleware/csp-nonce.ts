import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * Creates a fresh nonce for each request. The Content-Security-Policy allows
 * inline scripts carrying it, and the GOV.UK template adds it to its one
 * inline script.
 */
export function cspNonce(): RequestHandler {
  return (_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString("base64");
    next();
  };
}
