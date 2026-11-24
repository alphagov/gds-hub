// Invented pages for unit tests of the content routes and presenters. Every
// name, address and value here is synthetic.

import type {
  PageDetail,
  PageRecord,
  ProductTeamServiceSummary,
} from "../../src/repositories/index.js";
import type { ContentSection, ContentService } from "../../src/services/content/content-service.js";

const CREATED = new Date("2026-01-01T09:00:00Z");

export function pageRecord(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    id: 1,
    slug: "device-rules",
    title: "Device rules",
    pageType: "policy",
    summary: "What you can connect to the invented network.",
    bodyMarkdown: "## Scope\n\nThis covers **laptops**.\n\n## Exceptions\n\nAsk the team.",
    ownerName: "Information Security",
    ownerContact: "infosec@example.com",
    productTeamServiceId: null,
    status: "published",
    lastReviewedAt: "2026-07-15",
    publishedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

export const mappingTeam: ProductTeamServiceSummary = {
  id: 1,
  key: "mapping-team",
  slug: "mapping-team",
  name: "Mapping Team",
};

export function pageDetail(
  overrides: Partial<PageRecord> = {},
  productTeamService: ProductTeamServiceSummary | null = null,
): PageDetail {
  const productTeamServiceId = productTeamService?.id ?? null;
  return { page: pageRecord({ productTeamServiceId, ...overrides }), productTeamService };
}

/** The page type each content section shows. A guide's page type is "service_guide". */
const SECTION_OF: Record<PageRecord["pageType"], ContentSection | undefined> = {
  policy: "policies",
  guidance: "guidance",
  service_guide: "guidance",
  general: undefined,
  whats_new: undefined,
};

/**
 * A content service over fixed pages. Like the real one, it only gives
 * published pages of the section's types, so tests can include drafts and
 * pages of other types to check a route doesn't show them.
 */
export function fakeContent(
  pages: readonly PageDetail[] = [
    pageDetail(),
    pageDetail({ id: 2, slug: "cake-rules", title: "Cake rules", pageType: "policy" }),
    pageDetail({ id: 3, slug: "choosing-a-pen", title: "Choosing a pen", pageType: "guidance" }),
    pageDetail(
      { id: 4, slug: "mapping-quickstart", title: "Mapping quickstart", pageType: "service_guide" },
      mappingTeam,
    ),
    pageDetail(
      { id: 5, slug: "draft-guide", status: "draft", pageType: "service_guide" },
      mappingTeam,
    ),
    pageDetail({ id: 6, slug: "about-us", title: "About us", pageType: "general" }),
  ],
): ContentService {
  const visible = (section: ContentSection) =>
    pages.filter(
      ({ page }) => page.status === "published" && SECTION_OF[page.pageType] === section,
    );
  return {
    pages: (section) =>
      Promise.resolve(
        visible(section)
          .map(({ page }) => page)
          .sort((a, b) => a.title.localeCompare(b.title)),
      ),
    page: (section, slug) =>
      Promise.resolve(visible(section).find(({ page }) => page.slug === slug)),
    serviceGuides: (productTeamServiceId) =>
      Promise.resolve(
        pages
          .filter(
            ({ page }) =>
              page.status === "published" &&
              page.pageType === "service_guide" &&
              page.productTeamServiceId === productTeamServiceId,
          )
          .map(({ page }) => page),
      ),
  };
}
