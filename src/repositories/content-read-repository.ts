import { and, asc, eq, inArray } from "drizzle-orm";
import { pages, productTeamServices } from "../db/schema/index.js";
import { toRepositoryError } from "./errors.js";
import type { Executor } from "./executor.js";
import type { PageDetail, PageRecord } from "./read-models.js";

type PageType = PageRecord["pageType"];

/**
 * Read access to pages for the public read pages. The published filter is in
 * every query here, so a draft can never reach a route.
 */
export interface ContentReadRepository {
  /** The published pages of these types, in title order. */
  publishedPages(types: readonly PageType[]): Promise<PageRecord[]>;
  /**
   * A published page of one of these types, with the team that owns it. Undefined
   * if there's no such page, it's a draft or it's another type.
   */
  publishedPage(slug: string, types: readonly PageType[]): Promise<PageDetail | undefined>;
  /** The published service guides that belong to a product, team or service, in title order. */
  publishedServiceGuides(productTeamServiceId: number): Promise<PageRecord[]>;
}

export function createContentReadRepository(executor: Executor): ContentReadRepository {
  return {
    async publishedPages(types) {
      if (types.length === 0) return [];
      try {
        return await executor
          .select()
          .from(pages)
          .where(and(eq(pages.status, "published"), inArray(pages.pageType, [...types])))
          .orderBy(asc(pages.title), asc(pages.slug));
      } catch (error) {
        throw toRepositoryError(error, "page", "read");
      }
    },

    async publishedPage(slug, types) {
      if (types.length === 0) return undefined;
      try {
        const [row] = await executor
          .select({
            page: pages,
            team: {
              id: productTeamServices.id,
              key: productTeamServices.key,
              slug: productTeamServices.slug,
              name: productTeamServices.name,
            },
          })
          .from(pages)
          .leftJoin(productTeamServices, eq(pages.productTeamServiceId, productTeamServices.id))
          .where(
            and(
              eq(pages.slug, slug),
              eq(pages.status, "published"),
              inArray(pages.pageType, [...types]),
            ),
          )
          .limit(1);
        // A left join with no match gives a team with every field null.
        return row === undefined
          ? undefined
          : { page: row.page, productTeamService: row.team?.id == null ? null : row.team };
      } catch (error) {
        throw toRepositoryError(error, "page", "read");
      }
    },

    async publishedServiceGuides(productTeamServiceId) {
      try {
        return await executor
          .select()
          .from(pages)
          .where(
            and(
              eq(pages.status, "published"),
              eq(pages.pageType, "service_guide"),
              eq(pages.productTeamServiceId, productTeamServiceId),
            ),
          )
          .orderBy(asc(pages.title), asc(pages.slug));
      } catch (error) {
        throw toRepositoryError(error, "page", "read");
      }
    },
  };
}
