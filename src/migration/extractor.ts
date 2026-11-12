import { load, type CheerioAPI } from "cheerio";
// Type-only: cheerio's own node types, from the parser it is built on.
import type { AnyNode, Element } from "domhandler";
import TurndownService from "turndown";
import { BLOG_DATE_SELECTOR } from "./hub-structure.js";
import { rewriteLink, type LinkContext } from "./links.js";
import { warning, type MigrationWarning } from "./records.js";

/**
 * Turns a built page into a title and a markdown body. Only the content area
 * is kept. Anything markdown can't show is kept as HTML and flagged for
 * manual review, never silently dropped. Warnings name elements and paths,
 * never content.
 */

export interface ExtractOptions {
  readonly contentSelector: string;
  readonly stripSelectors: readonly string[];
  readonly link: LinkContext;
}

export interface ExtractedContent {
  /** The text of the first h1, which is left out of the body. */
  readonly title: string | undefined;
  readonly bodyMarkdown: string;
  /** A blog post's date (YYYY-MM-DD), from its "Published on" line. */
  readonly publishedDate: string | undefined;
  /** Old paths of the images and downloads the page links to. */
  readonly assets: readonly string[];
  readonly warnings: readonly MigrationWarning[];
}

/** Kept as HTML because markdown has no equivalent. Each is flagged for manual review. */
const UNSUPPORTED_BLOCK = [
  "iframe",
  "form",
  "dl",
  "details",
  "video",
  "audio",
  "object",
  "embed",
  "canvas",
  "map",
];
const UNSUPPORTED_INLINE = ["input", "button", "select", "textarea", "svg", "math"];
const UNSUPPORTED = [...UNSUPPORTED_BLOCK, ...UNSUPPORTED_INLINE].join(", ");

/** Removed, with a warning: they are behaviour or styling, not content. */
const REMOVED = "script, style, noscript, template";

/** A table with any of these inside can't be a markdown table. */
const COMPLEX_TABLE_CONTENT = "table, ul, ol, pre, blockquote, h1, h2, h3, h4, h5, h6, dl";

/** Code block classes that aren't a language. */
const NOT_A_LANGUAGE = new Set(["highlight", "plaintext", "text", "code", "nohighlight"]);

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** The parts of a turndown list item node this module reads. */
interface ListItemNode {
  readonly parentNode: {
    readonly nodeName: string;
    readonly children: ArrayLike<unknown>;
    getAttribute(name: string): string | null;
  } | null;
  readonly nextSibling: unknown;
}

/** List items with a single space after the marker ("- item", "1. item"). */
function listItem(content: string, node: unknown): string {
  const item = node as ListItemNode;
  const parent = item.parentNode;
  let prefix = "- ";
  if (parent?.nodeName === "OL") {
    const start = Number(parent.getAttribute("start") ?? "1");
    const index = Array.from(parent.children).indexOf(node);
    prefix = `${(Number.isInteger(start) ? start : 1) + index}. `;
  }
  const isParagraph = /\n$/.test(content);
  const body = content.replace(/^\n+/, "").replace(/\n+$/, "") + (isParagraph ? "\n" : "");
  const indented = body.replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
  return `${prefix}${indented}${item.nextSibling ? "\n" : ""}`;
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined",
    br: "  ",
  });
  service.addRule("listItem", { filter: "li", replacement: listItem });
  // Turndown escapes markdown in text but not "<" or "&", so text such as
  // "&lt;details&gt;" would become a real tag in the markdown. Escape anything
  // that would start a tag, comment or entity, so it stays text.
  const escapeMarkdown = service.escape.bind(service);
  service.escape = (text: string) =>
    escapeMarkdown(text)
      .replace(/<(?=[A-Za-z/!?])/g, "\\<")
      .replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
  return service;
}

const turndown = createTurndown();

/** Placeholders for blocks converted outside turndown, swapped back in afterwards. */
const blockToken = (index: number) => `MIGRATIONBLOCK${index}X`;
const inlineToken = (index: number) => `MIGRATIONINLINE${index}X`;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The HTML of an element, without blank lines (which would end a markdown HTML block). */
function keptHtml($: CheerioAPI, element: AnyNode): string {
  return $.html(element)
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

/** Reads a date such as "Published on: October  8, 2026" as 2026-10-08. */
export function readPublishedDate(text: string): string | undefined {
  const match = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (match === null) return undefined;
  const monthName = (match[1] ?? "").toLowerCase();
  const month = MONTHS.findIndex((m) => m === monthName || m.slice(0, 3) === monthName) + 1;
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month === 0) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString().slice(0, 10);
}

/** The target of a meta refresh redirect page, or undefined for an ordinary page. */
export function redirectTarget(html: string): string | undefined {
  const $ = load(html);
  for (const element of $("meta").toArray()) {
    const meta = $(element);
    if ((meta.attr("http-equiv") ?? "").toLowerCase() !== "refresh") continue;
    const target = /url\s*=\s*['"]?([^'"\s>]+)/i.exec(meta.attr("content") ?? "")?.[1];
    if (target !== undefined) return target;
  }
  return undefined;
}

/** Whether the page has the content area. */
export function hasContentArea(html: string, contentSelector: string): boolean {
  return load(html)(contentSelector).length > 0;
}

export function extractContent(html: string, options: ExtractOptions): ExtractedContent {
  const $ = load(html);
  const warnings: MigrationWarning[] = [];
  const assets = new Set<string>();

  const areas = $(options.contentSelector);
  const area = areas.first();
  if (areas.length === 0) {
    return {
      title: undefined,
      bodyMarkdown: "",
      publishedDate: undefined,
      assets: [],
      warnings: [warning("content_area_missing", "no element matches the content selector")],
    };
  }
  if (areas.length > 1) {
    warnings.push(
      warning(
        "multiple_content_areas",
        `${areas.length} elements match the content selector, so only the first was used`,
      ),
    );
  }

  // The blog date line is on the strip-list, so read it first.
  let publishedDate: string | undefined;
  const dateLine = area.find(BLOG_DATE_SELECTOR).first();
  if (dateLine.length > 0) {
    publishedDate = readPublishedDate(dateLine.text());
    if (publishedDate === undefined) {
      warnings.push(warning("invalid_date", "the blog post's published date couldn't be read"));
    }
    dateLine.remove();
  }

  for (const selector of options.stripSelectors) area.find(selector).remove();

  for (const element of area.find(REMOVED).toArray()) {
    warnings.push(warning("removed_element", `a <${element.tagName}> element was removed`, false));
    $(element).remove();
  }

  // The title.
  const headings = area.find("h1");
  const title = collapse(headings.first().text()) || undefined;
  if (title === undefined) {
    warnings.push(warning("missing_title", "the content area has no h1 to use as the title"));
  } else {
    headings.first().remove();
    if (headings.length > 1) {
      warnings.push(
        warning(
          "multiple_titles",
          "the content area has more than one h1, so the first is the title",
          false,
        ),
      );
    }
  }

  // Links and images.
  for (const element of area.find("a[href]").toArray()) {
    const anchor = $(element);
    const result = rewriteLink(anchor.attr("href") ?? "", options.link);
    if (result.kind !== "unchanged") anchor.attr("href", result.href);
    if (result.assetPath !== undefined) assets.add(result.assetPath);
    if (result.warning !== undefined) warnings.push(result.warning);
  }
  for (const element of area.find("img").toArray()) {
    const image = $(element);
    const result = rewriteLink(image.attr("src") ?? "", options.link);
    if (result.kind !== "unchanged") image.attr("src", result.href);
    if (result.assetPath !== undefined) assets.add(result.assetPath);
    if (result.warning !== undefined) warnings.push(result.warning);
    if (image.attr("alt") === undefined) {
      warnings.push(warning("missing_alt_text", "an image has no alternative text"));
    }
  }

  const blocks: string[] = [];
  const inlines: string[] = [];
  const replaceWithBlock = (element: AnyNode, markdown: string) => {
    $(element).replaceWith(`<p>${blockToken(blocks.length)}</p>`);
    blocks.push(markdown);
  };

  // Tables first, so a table holding anything markdown can't show is kept
  // whole. Simple ones become markdown tables, the rest are kept as HTML.
  // Tables inside an element that is kept as HTML stay as they are.
  for (const element of area.find("table").toArray()) {
    const table = $(element);
    if (table.parents("table").length > 0 || table.parents(UNSUPPORTED).length > 0) continue;
    const mergedCells = table
      .find("[rowspan], [colspan]")
      .toArray()
      .some(
        (cell) =>
          ($(cell).attr("rowspan") ?? "1") !== "1" || ($(cell).attr("colspan") ?? "1") !== "1",
      );
    if (mergedCells || table.find(`${COMPLEX_TABLE_CONTENT}, ${UNSUPPORTED}`).length > 0) {
      warnings.push(warning("complex_table", "a table markdown can't show was kept as HTML"));
      replaceWithBlock(element, keptHtml($, element));
    } else {
      replaceWithBlock(element, markdownTable($, element));
    }
  }

  // Elements markdown can't show, outermost only, kept as HTML. Those inside
  // a table that was kept as HTML were removed from the page with it.
  for (const element of area.find(UNSUPPORTED).toArray()) {
    if ($(element).parents(UNSUPPORTED).length > 0) continue;
    const tag = element.tagName;
    warnings.push(warning("unsupported_element", `a <${tag}> element was kept as HTML`));
    if (UNSUPPORTED_INLINE.includes(tag)) {
      const markup = keptHtml($, element).replace(/\s*\n\s*/g, " ");
      $(element).replaceWith(inlineToken(inlines.length));
      inlines.push(markup);
    } else {
      replaceWithBlock(element, keptHtml($, element));
    }
  }

  // Code blocks, keeping the language.
  for (const element of area.find("pre").toArray()) {
    replaceWithBlock(element, codeBlock($, element));
  }

  let markdown = turndown.turndown(area.html() ?? "");
  markdown = markdown.replace(
    /^(.*?)MIGRATIONBLOCK(\d+)X/gm,
    (_match, prefix: string, index: string) => {
      const block = blocks[Number(index)] ?? "";
      const continuation = prefix.replace(/[^>\s]/g, " ");
      return prefix + block.replace(/\n/g, `\n${continuation}`);
    },
  );
  markdown = markdown.replace(
    /MIGRATIONINLINE(\d+)X/g,
    (_match, index: string) => inlines[Number(index)] ?? "",
  );

  return {
    title,
    bodyMarkdown: markdown.trim(),
    publishedDate,
    assets: [...assets],
    warnings,
  };
}

/** A markdown table. The first row is the header. Pipes in cells are escaped. */
function markdownTable($: CheerioAPI, table: Element): string {
  const rows = $(table)
    .find("tr")
    .toArray()
    .map((row) =>
      $(row)
        .children("th, td")
        .toArray()
        .map((cell) =>
          turndown
            .turndown($(cell).html() ?? "")
            .trim()
            .replace(/\s*\n+\s*/g, "<br>")
            .replace(/\|/g, "\\|"),
        ),
    );
  const width = Math.max(0, ...rows.map((row) => row.length));
  const [header, ...body] = rows;
  if (header === undefined || width === 0) return "";
  const line = (cells: readonly string[]) =>
    `| ${[...cells, ...Array<string>(width - cells.length).fill("")].join(" | ")} |`;
  return [line(header), line(Array<string>(width).fill("---")), ...body.map(line)].join("\n");
}

/** A fenced code block, with the language from a language-* class or the highlighter's class. */
function codeBlock($: CheerioAPI, pre: Element): string {
  const element = $(pre);
  const classes = [
    ...(element.attr("class") ?? "").split(/\s+/),
    ...(element.children("code").first().attr("class") ?? "").split(/\s+/),
  ].filter((name) => name !== "");
  const declared = classes
    .map((name) => /^language-(.+)$/.exec(name)?.[1])
    .find((name) => name !== undefined);
  const guessed = classes.find(
    (name) => !NOT_A_LANGUAGE.has(name) && !name.startsWith("language-"),
  );
  const candidate = declared ?? guessed ?? "";
  const language =
    /^[A-Za-z0-9_+.#-]+$/.test(candidate) && !NOT_A_LANGUAGE.has(candidate) ? candidate : "";
  const code = element.text().replace(/\n$/, "");
  const longestFence = Math.max(0, ...(code.match(/^`{3,}/gm) ?? []).map((fence) => fence.length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}
