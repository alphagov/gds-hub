import { renderMarkdown } from "../lib/markdown.js";
import type { PageDetail, PageRecord } from "../repositories/index.js";
import type { ContentSection } from "../services/content/content-service.js";
import { CATALOGUE_PATHS, CONTENT_PATHS, ON_THIS_PAGE_LABEL, SECTIONS } from "../site-map.js";
import type {
  ContentLabel,
  ContentListingViewModel,
  ContentPageViewModel,
  LinkItem,
} from "../view-models.js";
import { contentsNavigation, type NavigationGroups } from "./contents.js";
import {
  emailLink,
  formatDate,
  HOME_BREADCRUMB,
  linkItem,
  nonBlank,
  sectionBreadcrumb,
} from "./format.js";

/** Shown when a page has no review date, as migrated pages don't. */
export const NOT_RECORDED = "Not recorded";

const EMPTY_TEXT: Readonly<Record<ContentSection, string>> = {
  policies: "There are no policies yet.",
  guidance: "There is no guidance yet.",
};

/** The address of a page, which depends on the section its type belongs to. */
function pagePath(section: ContentSection, slug: string): string {
  return section === "policies" ? CONTENT_PATHS.policy(slug) : CONTENT_PATHS.guidance(slug);
}

function reviewedOn(page: PageRecord): string {
  return formatDate(page.lastReviewedAt) ?? NOT_RECORDED;
}

export function presentContentListing(
  section: ContentSection,
  pages: readonly PageRecord[],
  groups: NavigationGroups,
): ContentListingViewModel {
  const { name, description } = SECTIONS[section];
  return {
    title: name,
    description,
    section,
    breadcrumbs: [HOME_BREADCRUMB],
    contents: contentsNavigation(groups),
    emptyText: EMPTY_TEXT[section],
    items: pages.map((page) => ({
      text: page.title,
      href: pagePath(section, page.slug),
      summary: nonBlank(page.summary),
      lastReviewed: reviewedOn(page),
    })),
  };
}

/** An owner or contact for the details list: a link where it can be one, otherwise text. */
function label(text: string | null, href: string | null): ContentLabel | null {
  return text === null ? null : { text, href };
}

export function presentContentPage(
  section: ContentSection,
  detail: PageDetail,
  groups: NavigationGroups,
): ContentPageViewModel {
  const { page, productTeamService } = detail;
  const rendered = renderMarkdown(page.bodyMarkdown);
  const contact = nonBlank(page.ownerContact);
  const email = emailLink(contact);
  return {
    title: page.title,
    section,
    breadcrumbs: [HOME_BREADCRUMB, sectionBreadcrumb(section)],
    contents: contentsNavigation(groups),
    summary: nonBlank(page.summary),
    owner: label(
      nonBlank(page.ownerName),
      productTeamService === null
        ? null
        : CATALOGUE_PATHS.productTeamService(productTeamService.slug),
    ),
    contact: label(contact, email?.href ?? null),
    lastReviewed: reviewedOn(page),
    onThisPageLabel: ON_THIS_PAGE_LABEL,
    onThisPage: rendered.headings.map((heading) => ({
      text: heading.text,
      href: `#${heading.id}`,
    })),
    bodyHtml: rendered.html,
  };
}

/** Links to a team's service guides, for its page. */
export function presentServiceGuides(guides: readonly PageRecord[]): LinkItem[] {
  return guides.map((guide) =>
    linkItem(guide.title, CONTENT_PATHS.guidance(guide.slug), guide.summary),
  );
}
