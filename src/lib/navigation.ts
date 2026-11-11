import { SECTION_KEYS, SECTIONS, type SectionKey } from "../site-map.js";

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

/**
 * The service navigation items for a request path, with the current section
 * marked. By default the section is worked out from the path. Pages whose
 * address isn't under their section's path (an instance page belongs to
 * Tools, for example) pass the section instead, and only it is marked.
 */
export function serviceNavigation(requestPath: string, section?: SectionKey): NavigationItem[] {
  // Express routing is case-insensitive, so /Tools renders the Tools page.
  // Section paths are lower case.
  const path = withoutTrailingSlash(requestPath).toLowerCase();
  return SECTION_KEYS.map((key) => {
    const { name, path: sectionPath } = SECTIONS[key];
    const current = path === sectionPath && (section === undefined || section === key);
    const inside =
      section === undefined ? path.startsWith(`${sectionPath}/`) : section === key && !current;
    return { text: name, href: sectionPath, current, active: inside };
  });
}
