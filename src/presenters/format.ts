import type { InstanceRecord } from "../repositories/index.js";
import { HOME_PATH, SECTIONS, type SectionKey } from "../site-map.js";
import type { Breadcrumb, LinkItem, SummaryRow, TagViewModel } from "../view-models.js";

// Small, pure helpers the presenters share. Every value they return is plain
// text: templates escape it, and nothing here builds HTML.

export const HOME_BREADCRUMB: Breadcrumb = { text: "Home", href: HOME_PATH };

/** A breadcrumb to a section's own page. */
export function sectionBreadcrumb(key: SectionKey): Breadcrumb {
  const { name, path } = SECTIONS[key];
  return { text: name, href: path };
}

/** Text with leading and trailing space removed, or null if nothing is left. */
export function nonBlank(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Text with its first letter in upper case, for labels stored in lower case. */
export function capitalise(text: string | null | undefined): string | null {
  const value = nonBlank(text);
  return value === null ? null : value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Splits plain text into paragraphs at blank lines. Missing or blank text
 * gives no paragraphs. The text is not treated as markdown or HTML.
 */
export function paragraphs(text: string | null | undefined): string[] {
  if (text === null || text === undefined) return [];
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

/**
 * The address to link to, if `url` is an absolute http or https URL.
 * Anything else (javascript:, data:, relative or malformed) gives undefined,
 * so it's never used as a link. The database checks this too.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  const value = nonBlank(url);
  if (value === null) return undefined;
  const parsed = URL.parse(value);
  if (parsed === null) return undefined;
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
}

/** A link to a website, showing its address, or null if it isn't a safe link. */
export function websiteLink(url: string | null | undefined): LinkItem | null {
  const href = safeHref(url);
  const text = nonBlank(url);
  return href === undefined || text === null ? null : { text, href };
}

// One "@", no spaces, and nothing that could break out of the attribute or
// add mailto headers (such as "?" or "&"). 254 characters is the longest
// address email allows, and keeps the pattern quick.
const EMAIL = /^[^\s@?&<>"']+@[^\s@?&<>"']+\.[^\s@?&<>"']+$/;
const MAX_EMAIL_LENGTH = 254;

/** A mailto link for an email address, or null if the text isn't a plain address. */
export function emailLink(address: string | null | undefined): LinkItem | null {
  const value = nonBlank(address);
  return value !== null && value.length <= MAX_EMAIL_LENGTH && EMAIL.test(value)
    ? { text: value, href: `mailto:${value}` }
    : null;
}

/** A link item, with a description only if there is one. */
export function linkItem(text: string, href: string, description?: string | null): LinkItem {
  const value = nonBlank(description);
  return value === null ? { text, href } : { text, href, description: value };
}

/** Summary list rows for the values that have text, in the order given. */
export function textRows(
  entries: readonly (readonly [string, string | null | undefined])[],
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const [key, value] of entries) {
    const text = nonBlank(value);
    if (text !== null) rows.push({ key: { text: key }, value: { text } });
  }
  return rows;
}

/** Names joined into one line, or null if there are none. */
export function joinNames(names: readonly string[]): string | null {
  return names.length === 0 ? null : names.join(", ");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * A date column value (YYYY-MM-DD) in GOV.UK style, for example
 * "1 October 2026". Null gives undefined. Anything unexpected is shown as stored.
 */
export function formatDate(isoDate: string | null | undefined): string | undefined {
  if (isoDate === null || isoDate === undefined) return undefined;
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate) ?? [];
  const monthName = month === undefined ? undefined : MONTHS[Number(month) - 1];
  if (year === undefined || day === undefined || monthName === undefined) return isoDate;
  return `${Number(day)} ${monthName} ${year}`;
}

/** A contract's dates, for example "1 April 2026 to 31 March 2027". */
export function dateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | undefined {
  const from = formatDate(start);
  const to = formatDate(end);
  if (from !== undefined && to !== undefined) return `${from} to ${to}`;
  if (from !== undefined) return `From ${from}`;
  if (to !== undefined) return `Until ${to}`;
  return undefined;
}

/** "Yes" or "No". */
export function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

/** A label for an attribute name stored in snake or kebab case, for example "Scan schedule". */
export function attributeLabel(name: string): string {
  return capitalise(name.replace(/[_-]+/g, " ")) ?? name;
}

export type MigrationStatus = InstanceRecord["migrationStatus"];

const MIGRATION_STATUS_TAGS: Readonly<Record<MigrationStatus, TagViewModel>> = {
  not_started: { text: "Not started", classes: "govuk-tag--grey" },
  // The default tag colour (blue).
  in_progress: { text: "In progress" },
  complete: { text: "Complete", classes: "govuk-tag--green" },
  not_applicable: { text: "Not applicable", classes: "govuk-tag--grey" },
};

/** The govukTag for where an instance is in the move to DSIT identity. */
export function migrationStatusTag(status: MigrationStatus): TagViewModel {
  return MIGRATION_STATUS_TAGS[status];
}

export const NOT_IN_USE_TAG: TagViewModel = { text: "Not in use", classes: "govuk-tag--grey" };

const TOOL_TYPES = {
  engineering: "Engineering tool",
  business: "Business tool",
} as const;

/** "Engineering tool", "Business tool", or null if it isn't recorded. */
export function toolTypeLabel(type: keyof typeof TOOL_TYPES | null): string | null {
  return type === null ? null : TOOL_TYPES[type];
}
