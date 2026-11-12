import { warning, type MigrationWarning } from "./records.js";

/** Somewhere to resolve relative links against. Never fetched. */
const OLD_SITE_BASE = "https://old-hub.invalid";

/** Images and downloads. Hosting them is decided separately, so they are only listed. */
const ASSET_EXTENSION =
  /\.(png|jpe?g|gif|svg|webp|ico|bmp|pdf|docx?|xlsx?|pptx?|odt|ods|odp|csv|txt|zip)$/i;

export interface LinkContext {
  /** The old address of the page the link is on. */
  readonly pagePath: string;
  readonly siteOrigins: readonly string[];
  readonly assetBasePath: string;
  /** Old addresses (normalised) and where each page is now. */
  readonly pathMap: ReadonlyMap<string, string>;
}

export interface LinkResult {
  readonly kind: "unchanged" | "page" | "asset";
  readonly href: string;
  /** The old path of an image or download. */
  readonly assetPath?: string;
  readonly warning?: MigrationWarning;
}

/**
 * An old address in one form: dot segments resolved and "index.html" left
 * off, so "/a/b/index.html" and "/a/b/" are the same.
 */
export function normaliseOldPath(oldPath: string): string {
  const { pathname } = new URL(oldPath, OLD_SITE_BASE);
  return pathname.endsWith("/index.html") ? pathname.slice(0, -"index.html".length) : pathname;
}

/** The old address of a built file, from its path in the build folder. */
export function oldPathOf(builtPath: string): string {
  return normaliseOldPath(`/${builtPath}`);
}

/**
 * The old path a redirect page sends people to, resolved against the page
 * it's on. Undefined if the target is on another site (an absolute address
 * on none of the site's origins) or isn't a web address at all.
 */
export function redirectOldPath(
  target: string,
  pagePath: string,
  siteOrigins: readonly string[],
): string | undefined {
  let url: URL;
  try {
    url = new URL(target.trim(), `${OLD_SITE_BASE}${pagePath}`);
  } catch {
    return undefined;
  }
  if (url.origin !== OLD_SITE_BASE && !siteOrigins.includes(url.origin)) return undefined;
  return normaliseOldPath(url.pathname);
}

/** Looks up an old address, also trying it with a trailing slash or ".html". */
export function findNewPath(
  oldPath: string,
  pathMap: ReadonlyMap<string, string>,
): string | undefined {
  const candidates =
    oldPath.endsWith("/") || oldPath.endsWith(".html")
      ? [oldPath]
      : [oldPath, `${oldPath}/`, `${oldPath}.html`];
  for (const candidate of candidates) {
    const found = pathMap.get(candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Schemes other than http and https that are left alone without a warning. */
const SAFE_OTHER_SCHEMES: ReadonlySet<string> = new Set(["mailto", "tel"]);

const UNCHANGED = (href: string): LinkResult => ({ kind: "unchanged", href });

/**
 * Where a link on a migrated page should point. Links to migrated pages go
 * to their new address (keeping any fragment), images and downloads to the
 * asset path, and anything else is left alone. A link to an internal page
 * that wasn't found, or one with a scheme such as javascript:, is left as it
 * was and flagged.
 */
export function rewriteLink(href: string, context: LinkContext): LinkResult {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) return UNCHANGED(href);

  let url: URL;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1];
  if (scheme !== undefined) {
    if (SAFE_OTHER_SCHEMES.has(scheme.toLowerCase())) return UNCHANGED(href);
    if (!/^https?$/i.test(scheme)) {
      // For example javascript: or data:. Rendering sanitises links anyway,
      // but a person should see these before the migration is agreed.
      return {
        kind: "unchanged",
        href,
        warning: warning(
          "unsafe_link",
          `a link or image uses the ${scheme.toLowerCase()}: scheme, which the new Hub won't show`,
        ),
      };
    }
    try {
      url = new URL(trimmed);
    } catch {
      return UNCHANGED(href);
    }
    if (!context.siteOrigins.includes(url.origin)) return UNCHANGED(href);
  } else {
    try {
      url = new URL(trimmed, `${OLD_SITE_BASE}${context.pagePath}`);
    } catch {
      return UNCHANGED(href);
    }
  }

  const oldPath = normaliseOldPath(url.pathname);
  if (ASSET_EXTENSION.test(oldPath)) {
    return { kind: "asset", href: `${context.assetBasePath}${oldPath}`, assetPath: oldPath };
  }

  const newPath = findNewPath(oldPath, context.pathMap);
  if (newPath !== undefined) return { kind: "page", href: `${newPath}${url.hash}` };

  return {
    kind: "unchanged",
    href,
    warning: warning(
      "unknown_internal_link",
      `the link to ${oldPath} doesn't match a migrated page, so it was left as it was`,
    ),
  };
}
