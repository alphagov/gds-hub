import type { ErrorRequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import type { RedirectService } from "../services/redirects/redirect-service.js";

/**
 * How long browsers and CloudFront may keep a redirect. Browsers keep a 301
 * with no Cache-Control indefinitely, so a mistaken redirect could never be
 * corrected for anyone who had followed it.
 */
export const REDIRECT_CACHE_CONTROL = "max-age=86400";

/**
 * Redirects a page not found to where the address now goes, if it has a
 * redirect (for example a page on the current Hub). It sits just before the
 * error handler, so a page that exists always wins over a redirect, and it
 * also catches the 404s that detail routes give for a record they can't find.
 * Only GET and HEAD are redirected. The query string is dropped.
 */
export function redirectOnNotFound(redirects: RedirectService): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    const isPageNotFound = err instanceof HttpError && err.status === 404;
    if (!isPageNotFound || (req.method !== "GET" && req.method !== "HEAD")) {
      next(err);
      return;
    }
    void redirects.newPathFor(req.path).then(
      (newPath) => {
        if (newPath === undefined) {
          next(err);
          return;
        }
        res.set("Cache-Control", REDIRECT_CACHE_CONTROL).redirect(301, newPath);
      },
      (lookupError: unknown) => {
        next(lookupError);
      },
    );
  };
}
