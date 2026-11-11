/**
 * The single source of truth for the site's names, paths and sections.
 *
 * The app, the unit tests and the Playwright tests all import from here, so
 * keep this module free of runtime dependencies (no Express, Nunjucks or
 * Node built-ins).
 */

export const SERVICE_NAME = "GDS Hub";

export const HOME_PATH = "/";

export interface Section {
  /** Shown in the service navigation and as the page heading. */
  readonly name: string;
  readonly path: `/${string}`;
  readonly description: string;
  /** False for pages whose responses must never be cached, such as search. */
  readonly cacheable: boolean;
}

export const SECTIONS = {
  tools: {
    name: "Tools",
    path: "/tools",
    description: "Find the tools and software used across GDS.",
    cacheable: true,
  },
  capabilities: {
    name: "Capabilities",
    path: "/capabilities",
    description: "Find out what GDS teams can do and who to talk to.",
    cacheable: true,
  },
  services: {
    name: "Services",
    path: "/services",
    description: "Find the services that GDS runs.",
    cacheable: true,
  },
  policies: {
    name: "Policies",
    path: "/policies",
    description: "Read the policies that apply to people working at GDS.",
    cacheable: true,
  },
  guidance: {
    name: "Guidance",
    path: "/guidance",
    description: "Read guidance for people working at GDS.",
    cacheable: true,
  },
  search: {
    name: "Search",
    path: "/search",
    description: "Search across the GDS Hub.",
    cacheable: false,
  },
} as const satisfies Record<string, Section>;

export type SectionKey = keyof typeof SECTIONS;

/** The sections in service navigation order. */
export const SECTION_LIST: readonly Section[] = Object.values(SECTIONS);

/** The section keys in service navigation order. */
export const SECTION_KEYS = Object.keys(SECTIONS) as readonly SectionKey[];

/**
 * Express route patterns for the catalogue's detail pages. Capabilities and
 * business units have no slug, so they use their key.
 */
export const CATALOGUE_ROUTES = {
  capability: "/capabilities/:key",
  tool: "/tools/:slug",
  instance: "/instances/:slug",
  productTeamService: "/services/:slug",
  businessUnit: "/business-units/:key",
  vendor: "/vendors/:slug",
} as const;

/** The address of each catalogue detail page, from the record's slug (or key). */
export const CATALOGUE_PATHS = {
  capability: (key: string) => `/capabilities/${encodeURIComponent(key)}`,
  tool: (slug: string) => `/tools/${encodeURIComponent(slug)}`,
  instance: (slug: string) => `/instances/${encodeURIComponent(slug)}`,
  productTeamService: (slug: string) => `/services/${encodeURIComponent(slug)}`,
  businessUnit: (key: string) => `/business-units/${encodeURIComponent(key)}`,
  vendor: (slug: string) => `/vendors/${encodeURIComponent(slug)}`,
} as const satisfies Record<keyof typeof CATALOGUE_ROUTES, (identifier: string) => string>;

/** The accessible name of the left-hand contents navigation, and its toggle on small screens. */
export const CONTENTS_LABEL = "Contents";

/** Public URLs of the static assets. */
export const ASSET_PATHS = {
  /** Where GOV.UK Frontend's fonts, images and manifest are served. Its CSS expects `/assets`. */
  assets: "/assets",
  stylesheet: "/assets/govuk-frontend.min.css",
  /** Our own styles, in public/stylesheets. */
  applicationStylesheet: "/stylesheets/application.css",
  frontendScript: "/assets/govuk-frontend.min.js",
  /** Also hard-coded as the import in public/javascripts/application.js. */
  applicationScript: "/javascripts/application.js",
} as const;

/** Routes that only exist when NODE_ENV is "test", so tests can reach the error pages. */
export const TEST_ROUTES = {
  forbidden: "/__test/forbidden",
  error: "/__test/error",
} as const;

export const ERROR_PAGES = {
  403: { title: "You do not have permission to view this page" },
  404: { title: "Page not found" },
  500: { title: "Sorry, there is a problem with the service" },
} as const satisfies Record<number, { readonly title: string }>;

export type ErrorStatus = keyof typeof ERROR_PAGES;

/** The text of the HTML <title>: the page title followed by the service name. */
export function documentTitle(pageTitle: string): string {
  return pageTitle === SERVICE_NAME ? SERVICE_NAME : `${pageTitle} - ${SERVICE_NAME}`;
}
