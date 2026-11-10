import type { Response } from "express";
import nunjucks from "nunjucks";
import { GOVUK_FRONTEND_DIST, VIEWS_DIR } from "../paths.js";
import { ASSET_PATHS, documentTitle, HOME_PATH, SERVICE_NAME } from "../site-map.js";
import type { ViewName, Views } from "../view-models.js";
import { serviceNavigation, type NavigationItem } from "./navigation.js";

/** Per-request data the layouts need, built in TypeScript rather than in templates. */
export interface LayoutModel {
  readonly cspNonce: string;
  readonly navigation: readonly NavigationItem[];
}

export interface Renderer {
  /** Renders a template with its view model. Rejects if the template fails. */
  renderToString<T extends ViewName>(
    template: T,
    page: Views[T],
    layout: LayoutModel,
  ): Promise<string>;
  /** Renders a template and sends it as the HTML response. Rejects if the template fails. */
  render<T extends ViewName>(
    res: Response,
    template: T,
    page: Views[T],
    status?: number,
  ): Promise<void>;
}

export interface RendererOptions {
  /** Re-read templates on every render. For local development. */
  readonly noCache?: boolean;
}

export function createRenderer(options: RendererOptions = {}): Renderer {
  const loader = new nunjucks.FileSystemLoader([VIEWS_DIR, GOVUK_FRONTEND_DIST], {
    noCache: options.noCache ?? false,
  });
  const env = new nunjucks.Environment(loader, { autoescape: true });

  function renderToString<T extends ViewName>(
    template: T,
    page: Views[T],
    layout: LayoutModel,
  ): Promise<string> {
    const context = {
      // Read directly by govuk/template.njk.
      cspNonce: layout.cspNonce,
      assetPath: ASSET_PATHS.assets,
      // Read by our layouts.
      layout: {
        serviceName: SERVICE_NAME,
        homePath: HOME_PATH,
        documentTitle: documentTitle(page.title),
        navigation: layout.navigation,
        assets: ASSET_PATHS,
      },
      page,
    };
    return new Promise((resolve, reject) => {
      env.render(template, context, (err, html) => {
        if (err) reject(err);
        else resolve(html ?? "");
      });
    });
  }

  async function render<T extends ViewName>(
    res: Response,
    template: T,
    page: Views[T],
    status = 200,
  ): Promise<void> {
    const html = await renderToString(template, page, {
      cspNonce: res.locals.cspNonce,
      navigation: serviceNavigation(res.req.path),
    });
    res.status(status).type("html").send(html);
  }

  return { renderToString, render };
}
