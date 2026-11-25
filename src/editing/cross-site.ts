import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The scheme the browser used. The load balancer ends TLS, so it says what the
 * browser asked for in X-Forwarded-Proto. A cross-site page can't set that
 * header, so reading it can only make the check stricter for a real editor.
 */
function schemeOf(req: Request): string {
  const forwarded = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded === "http" || forwarded === "https" ? forwarded : req.protocol;
}

function sameOrigin(req: Request): boolean {
  const site = req.get("sec-fetch-site");
  if (site !== undefined) return site === "same-origin" || site === "none";

  // Older browsers and some tools don't send Sec-Fetch-Site. Fall back to the
  // whole Origin (scheme, host and port), and allow requests that send neither (not from a browser).
  const origin = req.get("origin");
  if (origin === undefined) return true;
  try {
    const { protocol, host } = new URL(origin);
    return protocol === `${schemeOf(req)}:` && host === req.get("host");
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
