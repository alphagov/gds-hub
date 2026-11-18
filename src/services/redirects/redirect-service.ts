import type { RedirectLookup } from "../../repositories/index.js";
import { MAX_SITE_PATH_LENGTH, SITE_PATH } from "../../validation/catalogue.js";

/** Where an old address now goes, for addresses that have no page of their own. */
export interface RedirectService {
  /**
   * The path an old address now redirects to, or undefined if it has no
   * redirect. Matches the exact path first, then the same path with or
   * without its trailing slash, as Express treats those as the same page.
   * An address ending in index.html also matches its directory, as built
   * pages are stored by directory.
   * Never gives an address on another site, or the address itself.
   */
  newPathFor(path: string): Promise<string | undefined>;
}

export interface RedirectRepositories {
  readonly redirectLookup: RedirectLookup;
}

function isSitePath(path: string): boolean {
  return path.length <= MAX_SITE_PATH_LENGTH && SITE_PATH.test(path);
}

/** The path with its trailing slash added or removed. The root has no other form. */
function otherForm(path: string): string | undefined {
  if (path === "/") return undefined;
  return path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function createRedirectService({ redirectLookup }: RedirectRepositories): RedirectService {
  return {
    async newPathFor(path) {
      if (!isSitePath(path)) return undefined;
      const other = otherForm(path);
      const candidates = other === undefined ? [path] : [path, other];
      if (path.endsWith("/index.html")) {
        const directory = path.slice(0, -"index.html".length);
        candidates.push(directory);
        const directoryOther = otherForm(directory);
        if (directoryOther !== undefined) candidates.push(directoryOther);
      }
      const found = await redirectLookup.newPathsFor(candidates);
      const newPath = candidates
        .map((candidate) => found.get(candidate))
        .find((target) => target !== undefined);

      // The database checks new paths too. This is in case it ever doesn't.
      if (newPath === undefined || !isSitePath(newPath)) return undefined;
      // Browsers don't send fragments, so a target differing only by one loops.
      const targetPath = new URL(newPath, "https://hub.invalid").pathname;
      if (withoutTrailingSlash(targetPath) === withoutTrailingSlash(path)) return undefined;
      return newPath;
    },
  };
}
