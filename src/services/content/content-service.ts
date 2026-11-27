import { READER_PAGE_TYPES } from "../../validation/catalogue.js";
import type { PageDetail, PageRecord, Repositories } from "../../repositories/index.js";

/** The two parts of the site that show pages: /policies and /guidance. */
export type ContentSection = "policies" | "guidance";

/** The page types each section shows. The migration sends service guides to /guidance. */
const SECTION_PAGE_TYPES: Readonly<Record<ContentSection, readonly PageRecord["pageType"][]>> =
  READER_PAGE_TYPES;

/**
 * Read access to published pages for the read pages. Drafts and pages of
 * another section's type are never returned: a lookup for them gives
 * undefined, so the route can show the page not found page.
 */
export interface ContentService {
  /** A section's published pages, in title order. */
  pages(section: ContentSection): Promise<PageRecord[]>;
  /** One published page of the section, with the team that owns it. */
  page(section: ContentSection, slug: string): Promise<PageDetail | undefined>;
  /** The published service guides that belong to a product, team or service. */
  serviceGuides(productTeamServiceId: number): Promise<PageRecord[]>;
}

export type ContentRepositories = Pick<Repositories, "content">;

export function createContentService({ content }: ContentRepositories): ContentService {
  return {
    pages: (section) => content.publishedPages(SECTION_PAGE_TYPES[section]),
    page: (section, slug) => content.publishedPage(slug, SECTION_PAGE_TYPES[section]),
    serviceGuides: (productTeamServiceId) => content.publishedServiceGuides(productTeamServiceId),
  };
}
