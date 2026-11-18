import { z } from "zod";

/**
 * Zod schemas for the values the catalogue and content tables hold, matching
 * the database's own checks. They are shared, so the data migration (and
 * later the editing forms) refuse a value before the database would.
 *
 * The values here are the ones the enums in src/db/schema/enums.ts hold. A
 * test checks they stay the same.
 */

export const PAGE_TYPES = ["policy", "service_guide", "guidance", "general", "whats_new"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const MIGRATION_STATUSES = [
  "not_started",
  "in_progress",
  "complete",
  "not_applicable",
] as const;
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number];

export const TOOL_KINDS = ["engineering", "business"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const CONTENT_STATUSES = ["draft", "published"] as const;

/** Lower-case letters and digits in words separated by single hyphens, as the database checks. */
export const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** An absolute http or https URL with no spaces or control characters, as the database checks. */
export const HTTP_URL = /^https?:\/\/[^\s\p{Cc}]+$/iu;

/** A GitHub organisation name: letters and digits, with single hyphens between them. */
export const GITHUB_NAME = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/**
 * A path on this site: one leading slash, and no second slash or backslash
 * after it, so a browser can't read it as another site's address.
 */
export const SITE_PATH = /^\/(?![/\\])[^\s\p{Cc}\\]*$/u;

/** The length of pages.slug. Read pages refuse longer slugs and keys. */
export const MAX_SLUG_LENGTH = 160;

/** Whether text is a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const keySchema = z
  .string()
  .max(MAX_SLUG_LENGTH, `must be at most ${MAX_SLUG_LENGTH} characters`)
  .regex(KEBAB_CASE, "must be lower-case words separated by single hyphens");

export const httpUrlSchema = z.string().regex(HTTP_URL, "must be an http or https web address");

export const isoDateSchema = z
  .string()
  .refine(isCalendarDate, "must be a calendar date written as YYYY-MM-DD");

export const githubNameSchema = z.string().regex(GITHUB_NAME, "must be a GitHub organisation name");

/** The longest path a redirect can hold, as the database checks. */
export const MAX_SITE_PATH_LENGTH = 2048;

export const sitePathSchema = z
  .string()
  .max(MAX_SITE_PATH_LENGTH, `must be at most ${MAX_SITE_PATH_LENGTH} characters`)
  .regex(SITE_PATH, "must be a path on this site");

const name = z.string().trim().min(1, "must not be blank");
const optionalText = z.string().nullable();
const weight = z.number().int().nullable();

// The fields of each record, as plain shapes so callers can add their own
// fields (for example the migration's references by key) and keep strictness.

export const toolFields = {
  key: keySchema,
  slug: keySchema,
  name,
  description: optionalText,
  engineeringOrBusinessTool: z.enum(TOOL_KINDS).nullable(),
};

export const instanceFields = {
  key: keySchema,
  slug: keySchema,
  name,
  isPlaceholder: z.boolean(),
  url: httpUrlSchema.nullable(),
  description: optionalText,
  gettingAccess: optionalText,
  management: optionalText,
  authentication: optionalText,
  userProvisioning: optionalText,
  support: optionalText,
  escalationContact: optionalText,
  supportedByGdsSoftwareServiceDesk: z.boolean(),
  notInUse: z.boolean(),
  migrationStatus: z.enum(MIGRATION_STATUSES),
  migrationDate: isoDateSchema.nullable(),
  extraAttributes: z.record(z.string(), z.string()),
  lastReviewedAt: isoDateSchema.nullable(),
};

export const contractFields = {
  startDate: isoDateSchema.nullable(),
  endDate: isoDateSchema.nullable(),
  cost: optionalText,
  licenseTerms: optionalText,
  costModel: optionalText,
  commercials: optionalText,
  totalUsers: optionalText,
  operationalPolicy: optionalText,
  dataProtectionAndSecurity: optionalText,
};

/** A contract can't end before it starts. */
export function contractDatesInOrder(contract: {
  readonly startDate: string | null;
  readonly endDate: string | null;
}): boolean {
  return (
    contract.startDate === null ||
    contract.endDate === null ||
    contract.endDate >= contract.startDate
  );
}

export const CONTRACT_DATES_MESSAGE = {
  message: "must not be before the start date",
  path: ["endDate"],
};

export const ownershipLevelFields = {
  key: keySchema,
  name,
  definition: optionalText,
  description: optionalText,
  targetState: optionalText,
  weight,
  hideInNavigation: z.boolean(),
};

export const capabilityFields = {
  key: keySchema,
  name,
  description: optionalText,
  groupName: optionalText,
  comment: optionalText,
  weight,
  hideInNavigation: z.boolean(),
};

export const productTeamServiceFields = {
  key: keySchema,
  slug: keySchema,
  name,
  purpose: optionalText,
  url: httpUrlSchema.nullable(),
  slackChannel: httpUrlSchema.nullable(),
  slackChannelName: optionalText,
  teamEmailAddress: optionalText,
  ghOrgs: z.array(githubNameSchema),
  escalationContact: optionalText,
  lastReviewedAt: isoDateSchema.nullable(),
  weight,
};

export const businessUnitFields = {
  key: keySchema,
  name,
  level: optionalText,
  description: optionalText,
  lead: optionalText,
  url: httpUrlSchema.nullable(),
  escalationContact: optionalText,
  weight,
};

export const pageFields = {
  slug: keySchema,
  title: name.max(255, "must be at most 255 characters"),
  pageType: z.enum(PAGE_TYPES),
  summary: optionalText,
  ownerName: z.string().max(255, "must be at most 255 characters").nullable(),
  ownerContact: optionalText,
  status: z.enum(CONTENT_STATUSES),
  lastReviewedAt: isoDateSchema.nullable(),
  publishedAt: isoDateSchema.nullable(),
};

export const redirectFields = {
  oldPath: sitePathSchema,
  newPath: sitePathSchema,
};
