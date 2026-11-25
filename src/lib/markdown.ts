import * as cheerio from "cheerio";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

declare const safeHtml: unique symbol;

/**
 * HTML that is safe to put in a page. Only renderMarkdown makes one, after
 * sanitising it, and the one template partial that outputs it unescaped
 * (views/partials/rendered-markdown.njk) takes nothing else.
 */
export type SafeHtml = string & { readonly [safeHtml]: true };

/** An h2 in the rendered page, for the on-page contents. */
export interface RenderedHeading {
  readonly id: string;
  readonly text: string;
}

export interface RenderedMarkdown {
  readonly html: SafeHtml;
  /** The h2 headings in order, each with the id given to it in the html. */
  readonly headings: readonly RenderedHeading[];
}

// Migrated pages keep some HTML that markdown can't show, such as tables, so
// marked passes raw HTML through. Everything it produces is then sanitised
// with this allow-list, which is the only thing standing between content and
// the page.
const ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "pre",
  "code",
  "blockquote",
  "strong",
  "em",
  "hr",
  "br",
];

const SANITISE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // No class, id or style: content can't fake GOV.UK components or clobber the page.
  allowedAttributes: {
    a: ["href"],
    // A continued procedure can start above 1. The value is checked below.
    ol: ["start"],
    img: ["src", "alt"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
};

/** Ids the page itself uses, which a heading must not take. */
const RESERVED_IDS: ReadonlySet<string> = new Set(["main-content", "skip-link"]);

const HEADING_CLASSES: Readonly<Record<string, string>> = {
  h1: "govuk-heading-l",
  h2: "govuk-heading-m",
  h3: "govuk-heading-s",
  h4: "govuk-heading-s",
  h5: "govuk-heading-s",
  h6: "govuk-heading-s",
};

const CLASSES: Readonly<Record<string, string>> = {
  ...HEADING_CLASSES,
  p: "govuk-body",
  ul: "govuk-list govuk-list--bullet",
  ol: "govuk-list govuk-list--number",
  a: "govuk-link",
  table: "govuk-table",
  thead: "govuk-table__head",
  tbody: "govuk-table__body",
  tr: "govuk-table__row",
  th: "govuk-table__header",
  td: "govuk-table__cell",
  hr: "govuk-section-break govuk-section-break--visible",
};

/** Lower case words joined by hyphens, matching the anchors the old Hub made. */
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "section" : slug;
}

/**
 * Renders markdown from a page to safe HTML with GOV.UK classes. The input
 * is untrusted: it is sanitised before anything else touches it, and the
 * classes and ids are added afterwards, so content can't supply its own.
 */
export function renderMarkdown(markdown: string): RenderedMarkdown {
  const parsed = marked.parse(markdown, { async: false, gfm: true });
  const sanitised = sanitizeHtml(parsed, SANITISE_OPTIONS);
  const $ = cheerio.load(sanitised, null, false);

  for (const [tag, classes] of Object.entries(CLASSES)) {
    $(tag).addClass(classes);
  }

  // The sanitiser can't check a value, so keep a list's start only if it is a small whole number.
  $("ol[start]").each((_, element) => {
    const list = $(element);
    if (!/^\d{1,6}$/.test(list.attr("start") ?? "")) list.removeAttr("start");
  });

  const used = new Set<string>(RESERVED_IDS);
  const headings: RenderedHeading[] = [];
  $("h2, h3").each((_, element) => {
    const heading = $(element);
    const text = heading.text().replace(/\s+/g, " ").trim();
    const base = slugify(text);
    let id = base;
    for (let number = 2; used.has(id); number += 1) id = `${base}-${String(number)}`;
    used.add(id);
    heading.attr("id", id);
    if (element.tagName === "h2") headings.push({ id, text });
  });

  return { html: $.html() as SafeHtml, headings };
}
