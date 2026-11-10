import { SECTION_LIST } from "../site-map.js";

/** One item for the govukServiceNavigation macro. */
export interface NavigationItem {
  readonly text: string;
  readonly href: string;
  /** The page is the section's own page: sets aria-current="page". */
  readonly current: boolean;
  /** The page is inside the section: sets aria-current="true". */
  readonly active: boolean;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** The service navigation items for a request path, with the current section marked. */
export function serviceNavigation(requestPath: string): NavigationItem[] {
  const path = withoutTrailingSlash(requestPath);
  return SECTION_LIST.map((section) => ({
    text: section.name,
    href: section.path,
    current: path === section.path,
    active: path.startsWith(`${section.path}/`),
  }));
}
