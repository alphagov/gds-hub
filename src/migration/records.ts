/**
 * The common shape every migrated item is turned into, whichever input it
 * came from, before it is validated and loaded.
 *
 * Nothing here ever holds content in a warning or an issue: messages name
 * fields, elements, paths and keys only, so reports and logs are safe to keep.
 */

/** Where a record came from: a built page, or a YAML data file. */
export const SOURCE_TYPES = ["html", "yaml"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** The kind of database record a migration record becomes, in loading order. */
export const TARGET_ENTITIES = [
  "ownership_level",
  "tool",
  "contract",
  "instance",
  "capability",
  "product_team_service",
  "business_unit",
  "page",
  "redirect",
] as const;
export type TargetEntity = (typeof TARGET_ENTITIES)[number];

export type WarningCode =
  | "content_area_missing"
  | "multiple_content_areas"
  | "missing_title"
  | "multiple_titles"
  | "unsupported_element"
  | "removed_element"
  | "complex_table"
  | "unknown_internal_link"
  | "unsafe_link"
  | "missing_alt_text"
  | "unresolved_redirect"
  | "ambiguous_page"
  | "invalid_url"
  | "invalid_date"
  | "invalid_number"
  | "invalid_github_org"
  | "unmapped_value"
  | "unknown_field"
  | "ignored_field"
  | "defaulted_value"
  | "missing_value"
  | "complex_value"
  | "substring_tool_match"
  | "duplicate_key";

export interface MigrationWarning {
  readonly code: WarningCode;
  /** What happened, naming fields, elements, paths or keys. Never a value or content. */
  readonly message: string;
  /** True if a person needs to check the result before the migration is agreed. */
  readonly manualReview: boolean;
}

export function warning(code: WarningCode, message: string, manualReview = true): MigrationWarning {
  return { code, message, manualReview };
}

export function needsManualReview(warnings: readonly MigrationWarning[]): boolean {
  return warnings.some((w) => w.manualReview);
}

export interface MigrationRecord {
  /** The file it came from: a built page or a data file, relative to its input folder. */
  readonly sourcePath: string;
  readonly sourceType: SourceType;
  /** The built page it was rendered to or converted from, relative to the build folder. */
  readonly builtPath?: string;
  readonly targetEntity: TargetEntity;
  /** Its identifier: a YAML key, a page slug or a redirect's old path. */
  readonly key: string;
  readonly slug: string;
  /** The values to store, with references to other records by key. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** A page's body. */
  readonly bodyMarkdown?: string;
  readonly warnings: readonly MigrationWarning[];
}

/** A problem that stops a record being loaded. */
export interface ValidationIssue {
  readonly sourcePath: string;
  readonly sourceType: SourceType;
  readonly targetEntity?: TargetEntity;
  readonly key?: string;
  readonly field?: string;
  /** Names the problem, never the value. */
  readonly message: string;
}
