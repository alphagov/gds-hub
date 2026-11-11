import { Router } from "express";
import type { Renderer } from "../lib/render.js";
import { contentsNavigation } from "../presenters/contents.js";
import { HOME_BREADCRUMB } from "../presenters/format.js";
import type { CatalogueService } from "../services/catalogue/catalogue-service.js";
import { SECTIONS, type SectionKey } from "../site-map.js";
import type { SectionViewModel } from "../view-models.js";

/** Sections that don't have content yet. The catalogue router serves the others. */
export const PLACEHOLDER_SECTIONS: readonly SectionKey[] = ["policies", "guidance", "search"];

/** A placeholder page for each section that doesn't have content yet. */
export function pagesRouter(renderer: Renderer, catalogue: CatalogueService): Router {
  const router = Router();

  for (const key of PLACEHOLDER_SECTIONS) {
    const section = SECTIONS[key];

    router.get(section.path, (_req, res, next) => {
      if (!section.cacheable) res.set("Cache-Control", "no-store");
      catalogue
        .capabilityGroups()
        .then((groups) => {
          const page: SectionViewModel = {
            title: section.name,
            description: section.description,
            breadcrumbs: [HOME_BREADCRUMB],
            contents: contentsNavigation(groups),
            items: [],
          };
          return renderer.render(res, "pages/section.njk", page);
        })
        .catch(next);
    });
  }

  return router;
}
