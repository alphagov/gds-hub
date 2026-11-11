import { describe, expect, it } from "vitest";
import { serviceNavigation } from "../../src/lib/navigation.js";
import { createRenderer, type LayoutModel, type Renderer } from "../../src/lib/render.js";
import {
  ASSET_PATHS,
  ERROR_PAGES,
  HOME_PATH,
  SECTION_LIST,
  SECTIONS,
  SERVICE_NAME,
} from "../../src/site-map.js";
import type { ContentsViewModel, SectionViewModel } from "../../src/view-models.js";

const renderer: Renderer = createRenderer();
const { tools, services } = SECTIONS;

function layoutFor(path: string): LayoutModel {
  return { cspNonce: "test-nonce", navigation: serviceNavigation(path) };
}

const toolsPage: SectionViewModel = {
  title: tools.name,
  description: tools.description,
  breadcrumbs: [{ text: "Home", href: HOME_PATH }],
  items: [],
};

function renderSection(page: SectionViewModel = toolsPage): Promise<string> {
  return renderer.renderToString("pages/section.njk", page, layoutFor(tools.path));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** The opening tag of the first link to `href`. */
function linkTo(html: string, href: string): string {
  const match = new RegExp(`<a\\b[^>]*\\bhref="${escapeRegExp(href)}"[^>]*>`).exec(html);
  if (!match) throw new Error(`no link to ${href}`);
  return match[0];
}

describe("createRenderer", () => {
  it("puts the page title and service name in the document title", async () => {
    const html: string = await renderSection();
    const title = new RegExp(`<title[^>]*>\\s*${tools.name} - ${SERVICE_NAME}\\s*</title>`);

    expect(html).toMatch(title);
    expect(html).toContain('<html lang="en"');
  });

  it("escapes HTML in view model values", async () => {
    const html: string = await renderSection({ ...toolsPage, title: "<script>alert(1)</script>" });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders the header, service navigation, beta banner and footer", async () => {
    const html: string = await renderSection();

    expect(html).toContain("govuk-generic-header");
    expect(html).toContain("govuk-service-navigation");
    expect(html).toMatch(/govuk-phase-banner[\s\S]*Beta/);
    expect(html).toContain("govuk-footer");
    for (const section of SECTION_LIST) {
      expect(linkTo(html, section.path)).toContain("govuk-service-navigation__link");
    }
  });

  it("shows the service name in the header instead of GOV.UK", async () => {
    const html: string = await renderSection();
    const header: string = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    const homeLink: string = linkTo(header, HOME_PATH);

    expect(homeLink).toContain("govuk-generic-header__homepage-link");
    expect(header).toMatch(new RegExp(`homepage-link">\\s*${SERVICE_NAME}\\s*</a>`));
    expect(header).not.toContain("GOV.UK");
  });

  it("does not repeat the service name in the service navigation", async () => {
    const html: string = await renderSection();

    expect(html).not.toContain("govuk-service-navigation__service-name");
  });

  it("marks the current section in the service navigation", async () => {
    const html: string = await renderSection();

    expect(linkTo(html, tools.path)).toContain('aria-current="page"');
    expect(linkTo(html, services.path)).not.toContain("aria-current");
  });

  it("shows breadcrumbs only when the view model has them", async () => {
    const withCrumbs: string = await renderSection();
    const withoutCrumbs: string = await renderSection({
      title: toolsPage.title,
      description: toolsPage.description,
      items: [],
    });

    expect(withCrumbs).toContain("govuk-breadcrumbs");
    expect(withCrumbs).toContain(`class="govuk-breadcrumbs__link" href="${HOME_PATH}"`);
    expect(withoutCrumbs).not.toContain("govuk-breadcrumbs");
  });

  it("adds the CSP nonce to the inline script", async () => {
    const html: string = await renderSection();

    expect(html).toContain('<script nonce="test-nonce">');
  });

  it("links the stylesheets and the application script", async () => {
    const html: string = await renderSection();
    const script = new RegExp(
      `<script type="module"[^>]*src="${escapeRegExp(ASSET_PATHS.applicationScript)}"`,
    );

    expect(html).toContain(`href="${ASSET_PATHS.stylesheet}"`);
    expect(html).toContain(`href="${ASSET_PATHS.applicationStylesheet}"`);
    expect(html).toMatch(script);
  });

  it("shows an empty state on a listing with no items", async () => {
    const html: string = await renderSection();

    expect(html).toContain("Content will be added in a later phase.");
  });

  it("shows the items on a listing that has them", async () => {
    const itemPath = `${tools.path}/example`;
    const html: string = await renderSection({
      ...toolsPage,
      items: [{ text: "Example tool", href: itemPath }],
    });

    expect(linkTo(html, itemPath)).toContain("govuk-link");
    expect(html).toContain("Example tool");
    expect(html).not.toContain("Content will be added in a later phase.");
  });

  it("shows the request ID on the server error page", async () => {
    const html: string = await renderer.renderToString(
      "errors/500.njk",
      { title: ERROR_PAGES[500].title, requestId: "req-123" },
      layoutFor("/anything"),
    );

    expect(html).toContain(ERROR_PAGES[500].title);
    expect(html).toContain("req-123");
  });

  it("rejects when a template fails to render", async () => {
    // The cast deliberately bypasses the type check to reach a template that does not exist.
    const missing = "pages/missing.njk" as "pages/home.njk";

    await expect(
      renderer.renderToString(missing, { title: "x", groups: [] }, layoutFor(HOME_PATH)),
    ).rejects.toThrow();
  });

  describe("the contents", () => {
    const contents: ContentsViewModel = {
      label: "Contents",
      groups: [
        {
          name: "Cartography <maps>",
          items: [
            { text: "Map making", href: "/capabilities/map-making", current: true },
            { text: "Globe spinning", href: "/capabilities/globe-spinning", current: false },
          ],
        },
      ],
    };

    function renderWithContents(value: ContentsViewModel | undefined): Promise<string> {
      return renderSection(value === undefined ? toolsPage : { ...toolsPage, contents: value });
    }

    it("is one navigation landmark with a full list and a collapsible copy", async () => {
      const html: string = await renderWithContents(contents);

      expect(html.match(/<nav class="app-contents"/g)).toHaveLength(1);
      expect(html).toContain('<nav class="app-contents" aria-label="Contents">');
      expect(html).toMatch(/<div class="app-contents__full">[\s\S]*Map making/);
      expect(html).toMatch(
        /<details class="govuk-details app-contents__collapsible">[\s\S]*?Contents[\s\S]*?Map making[\s\S]*?<\/details>/,
      );
    });

    it("marks the current page and escapes the group names", async () => {
      const html: string = await renderWithContents(contents);

      expect(html).toContain('href="/capabilities/map-making" aria-current="page"');
      expect(html).not.toContain('href="/capabilities/globe-spinning" aria-current');
      expect(html).toContain("Cartography &lt;maps&gt;");
    });

    it("is inside the main element with the page content", async () => {
      const html: string = await renderWithContents(contents);
      const main: string = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[0] ?? "";

      expect(main).toMatch(/^<main class="govuk-main-wrapper" id="main-content"/);
      expect(main).toContain('<nav class="app-contents" aria-label="Contents">');
      expect(main).toContain(`<h1 class="govuk-heading-xl">${tools.name}</h1>`);
    });

    it("sits beside the page content in a quarter-width column", async () => {
      const html: string = await renderWithContents(contents);

      expect(html).toContain('class="govuk-grid-column-one-quarter-from-desktop"');
      expect(html).toContain('class="govuk-grid-column-three-quarters-from-desktop"');
    });

    it("is left out, with the page at full width, when there are no groups", async () => {
      for (const value of [undefined, { label: "Contents", groups: [] }]) {
        const html: string = await renderWithContents(value);

        expect(html).not.toContain("app-contents");
        expect(html).toContain('class="govuk-grid-column-full"');
      }
    });
  });
});
