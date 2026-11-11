import { Router, type Request, type RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import type { Renderer } from "../lib/render.js";
import { presentCapabilities, presentCapability, presentHome } from "../presenters/capabilities.js";
import type { NavigationGroups } from "../presenters/contents.js";
import {
  presentBusinessUnit,
  presentProductTeamService,
  presentServices,
} from "../presenters/organisation.js";
import { presentInstance, presentTool, presentTools, presentVendor } from "../presenters/tools.js";
import type { CatalogueService } from "../services/catalogue/catalogue-service.js";
import { CATALOGUE_ROUTES, HOME_PATH, SECTIONS } from "../site-map.js";
import type { ViewName, Views } from "../view-models.js";

// Matches the database's rule for slugs and keys (kebab case). Anything else
// can't be a record, so it gets the page not found page without a query.
const IDENTIFIER = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_IDENTIFIER_LENGTH = 160;

/** The route's slug or key, if it could belong to a record. */
function identifierFrom(req: Request, param: "slug" | "key"): string | undefined {
  const value: unknown = req.params[param];
  if (typeof value !== "string" || value.length > MAX_IDENTIFIER_LENGTH) return undefined;
  return IDENTIFIER.test(value) ? value : undefined;
}

/**
 * A handler that loads a page's view model and renders it. If `load` gives
 * undefined (no such record), the page not found page is shown instead.
 */
function page<T extends ViewName>(
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

/** The catalogue's read pages: capabilities, tools, instances, services, units and vendors. */
export function catalogueRouter(renderer: Renderer, catalogue: CatalogueService): Router {
  const router = Router();

  /** Loads a detail page's record and the contents. Undefined if there's no such record. */
  function detail<D, V>(
    param: "slug" | "key",
    find: (identifier: string) => Promise<D | undefined>,
    present: (found: D, groups: NavigationGroups) => V,
  ): (req: Request) => Promise<V | undefined> {
    return async (req) => {
      const identifier = identifierFrom(req, param);
      if (identifier === undefined) return undefined;
      const [found, groups] = await Promise.all([find(identifier), catalogue.capabilityGroups()]);
      return found === undefined ? undefined : present(found, groups);
    };
  }

  router.get(
    HOME_PATH,
    page(renderer, "pages/home.njk", async () => presentHome(await catalogue.capabilityGroups())),
  );

  router.get(
    SECTIONS.capabilities.path,
    page(renderer, "pages/capabilities.njk", async () =>
      presentCapabilities(await catalogue.capabilityGroups()),
    ),
  );

  router.get(
    CATALOGUE_ROUTES.capability,
    page(
      renderer,
      "pages/capability.njk",
      detail("key", (key) => catalogue.capability(key), presentCapability),
    ),
  );

  router.get(
    SECTIONS.tools.path,
    page(renderer, "pages/tools.njk", async () => {
      const [tools, groups] = await Promise.all([catalogue.tools(), catalogue.capabilityGroups()]);
      return presentTools(tools, groups);
    }),
  );

  router.get(
    CATALOGUE_ROUTES.tool,
    page(
      renderer,
      "pages/tool.njk",
      detail("slug", (slug) => catalogue.tool(slug), presentTool),
    ),
  );

  router.get(
    CATALOGUE_ROUTES.instance,
    page(
      renderer,
      "pages/instance.njk",
      detail("slug", (slug) => catalogue.instance(slug), presentInstance),
    ),
  );

  router.get(
    CATALOGUE_ROUTES.vendor,
    page(
      renderer,
      "pages/vendor.njk",
      detail("slug", (slug) => catalogue.vendor(slug), presentVendor),
    ),
  );

  router.get(
    SECTIONS.services.path,
    page(renderer, "pages/services.njk", async () => {
      const [directory, groups] = await Promise.all([
        catalogue.serviceDirectory(),
        catalogue.capabilityGroups(),
      ]);
      return presentServices(directory, groups);
    }),
  );

  router.get(
    CATALOGUE_ROUTES.productTeamService,
    page(
      renderer,
      "pages/product-team-service.njk",
      detail("slug", (slug) => catalogue.productTeamService(slug), presentProductTeamService),
    ),
  );

  router.get(
    CATALOGUE_ROUTES.businessUnit,
    page(
      renderer,
      "pages/business-unit.njk",
      detail("key", (key) => catalogue.businessUnit(key), presentBusinessUnit),
    ),
  );

  return router;
}
