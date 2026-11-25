import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

function sameOrigin(req: Request): boolean {
  const site = req.get("sec-fetch-site");
  if (site !== undefined) return site === "same-origin" || site === "none";

  // Older browsers and some tools don't send Sec-Fetch-Site. Fall back to the
  // Origin header, and allow requests that send neither (not from a browser).
  const origin = req.get("origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

/**
 * Refuses a write that a browser sent from another site, so a page on
 * another site can't make someone's browser edit the Hub. Reads are not
 * checked.
 */
export function refuseCrossSiteWrites(): RequestHandler {
  return (req, _res, next) => {
    next(SAFE_METHODS.has(req.method) || sameOrigin(req) ? undefined : new HttpError(403));
  };
}
