import { Router, type Request } from "express";
import type { Renderer } from "../lib/render.js";
import { presentContentListing, presentContentPage } from "../presenters/pages.js";
import type { CatalogueService } from "../services/catalogue/catalogue-service.js";
import type { ContentSection, ContentService } from "../services/content/content-service.js";
import { CONTENT_ROUTES, SECTIONS } from "../site-map.js";
import type { ContentListingViewModel, ContentPageViewModel } from "../view-models.js";
import { identifierFrom, page } from "./route-helpers.js";

/** The policies and guidance read pages: a listing and a page for each. */
export function contentRouter(
  renderer: Renderer,
  catalogue: CatalogueService,
  content: ContentService,
): Router {
  const router = Router();

  function listing(section: ContentSection): (req: Request) => Promise<ContentListingViewModel> {
    return async () => {
      const [pages, groups] = await Promise.all([
        content.pages(section),
        catalogue.capabilityGroups(),
      ]);
      return presentContentListing(section, pages, groups);
    };
  }

  function detail(
    section: ContentSection,
  ): (req: Request) => Promise<ContentPageViewModel | undefined> {
    return async (req) => {
      const slug = identifierFrom(req, "slug");
      if (slug === undefined) return undefined;
      const [found, groups] = await Promise.all([
        content.page(section, slug),
        catalogue.capabilityGroups(),
      ]);
      return found === undefined ? undefined : presentContentPage(section, found, groups);
    };
  }

  router.get(
    SECTIONS.policies.path,
    page(renderer, "pages/content-listing.njk", listing("policies")),
  );
  router.get(CONTENT_ROUTES.policy, page(renderer, "pages/content-page.njk", detail("policies")));
  router.get(
    SECTIONS.guidance.path,
    page(renderer, "pages/content-listing.njk", listing("guidance")),
  );
  router.get(CONTENT_ROUTES.guidance, page(renderer, "pages/content-page.njk", detail("guidance")));

  return router;
}
