import { inArray } from "drizzle-orm";
import { redirects } from "../db/schema/index.js";
import { toRepositoryError } from "./errors.js";
import type { Executor } from "./executor.js";

/** Finds where old addresses now go. Redirects are written through the redirects repository. */
export interface RedirectLookup {
  /**
   * The new path for each of the old paths that has a redirect. Old paths are
   * matched exactly, including letter case and any trailing slash.
   */
  newPathsFor(oldPaths: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export function createRedirectLookup(executor: Executor): RedirectLookup {
  return {
    async newPathsFor(oldPaths) {
      if (oldPaths.length === 0) return new Map();
      try {
        const rows = await executor
          .select({ oldPath: redirects.oldPath, newPath: redirects.newPath })
          .from(redirects)
          .where(inArray(redirects.oldPath, [...oldPaths]));
        return new Map(rows.map((row) => [row.oldPath, row.newPath]));
      } catch (error) {
        throw toRepositoryError(error, "redirect", "read");
      }
    },
  };
}
