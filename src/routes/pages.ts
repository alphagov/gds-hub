import { Router } from "express";
import type { Renderer } from "../lib/render.js";
import { HOME_PATH, SECTION_LIST, SERVICE_NAME } from "../site-map.js";
import type { HomeViewModel, SectionViewModel } from "../view-models.js";

/** The home page and a placeholder page for each section. */
export function pagesRouter(renderer: Renderer): Router {
  const router = Router();

  const home: HomeViewModel = {
    title: SERVICE_NAME,
    sections: SECTION_LIST.map(({ name, path, description }) => ({
      text: name,
      href: path,
      description,
    })),
  };

  router.get(HOME_PATH, (_req, res, next) => {
    renderer.render(res, "pages/home.njk", home).catch(next);
  });

  for (const section of SECTION_LIST) {
    const page: SectionViewModel = {
      title: section.name,
      description: section.description,
      breadcrumbs: [{ text: "Home", href: HOME_PATH }],
      items: [],
    };

    router.get(section.path, (_req, res, next) => {
      if (!section.cacheable) res.set("Cache-Control", "no-store");
      renderer.render(res, "pages/section.njk", page).catch(next);
    });
  }

  return router;
}
