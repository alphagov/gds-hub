import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import type { Renderer } from "../lib/render.js";
import type { ViewName, Views } from "../view-models.js";

// Helpers the routers share.

// Matches the database's rule for slugs and keys (kebab case). Anything else
// can't be a record, so it gets the page not found page without a query.
const IDENTIFIER = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_IDENTIFIER_LENGTH = 160;

/** The route's slug or key, if it could belong to a record. */
export function identifierFrom(req: Request, param: "slug" | "key"): string | undefined {
  const value: unknown = req.params[param];
  if (typeof value !== "string" || value.length > MAX_IDENTIFIER_LENGTH) return undefined;
  return IDENTIFIER.test(value) ? value : undefined;
}

/**
 * A handler that loads a page's view model and renders it. If `load` gives
 * undefined (no such record), the page not found page is shown instead.
 */
export function page<T extends ViewName>(
  renderer: Renderer,
  template: T,
  load: (req: Request) => Promise<Views[T] | undefined>,
): RequestHandler {
  return (req, res, next) => {
    const handle = async (): Promise<void> => {
      const model = await load(req);
      if (model === undefined) {
        next(new HttpError(404));
        return;
      }
      await renderer.render(res, template, model);
    };
    handle().catch(next);
  };
}
