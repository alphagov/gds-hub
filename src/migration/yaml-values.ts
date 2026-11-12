import {
  GITHUB_NAME,
  HTTP_URL,
  isCalendarDate,
  type MigrationStatus,
  type ToolKind,
} from "../validation/catalogue.js";
import {
  warning,
  type MigrationWarning,
  type TargetEntity,
  type ValidationIssue,
} from "./records.js";

/**
 * Reads the values of one YAML record, turning them into what the database
 * stores and noting anything that needs a person. Messages name fields only,
 * never their values.
 */
export class YamlValues {
  readonly warnings: MigrationWarning[] = [];
  readonly issues: ValidationIssue[] = [];
  /** Values kept as text because they couldn't be stored in their own column (instances only). */
  readonly extras: Record<string, string> = {};

  constructor(
    readonly sourcePath: string,
    readonly entity: TargetEntity,
    readonly key: string,
    readonly values: Readonly<Record<string, unknown>>,
    /** Whether a value that can't be stored is kept in extras (instances have extra attributes). */
    private readonly keepExtras = false,
  ) {}

  has(field: string): boolean {
    const value = this.values[field];
    return value !== undefined && value !== null && value !== "";
  }

  issue(field: string, message: string): void {
    this.issues.push({
      sourcePath: this.sourcePath,
      sourceType: "yaml",
      targetEntity: this.entity,
      key: this.key,
      field,
      message,
    });
  }

  private keep(field: string, raw: string): void {
    if (this.keepExtras) this.extras[field] = raw;
  }

  /** Text, trimmed. Blank becomes null. Numbers and booleans become text. */
  text(field: string): string | null {
    const value = this.values[field];
    if (value === undefined || value === null) return null;
    if (typeof value === "string") return value.trim() === "" ? null : value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    this.warnings.push(
      warning(
        "complex_value",
        `${field} is a list or nested value where text was expected, so it wasn't migrated`,
      ),
    );
    return null;
  }

  /** The record's name, or its key (with a warning) if it has none. */
  name(): string {
    const value = this.text("name");
    if (value !== null) return value;
    this.warnings.push(warning("missing_value", "name isn't set, so the key is used as the name"));
    return this.key;
  }

  /** true or false. Anything else is an issue. Unset is `fallback`. */
  bool(field: string, fallback = false): boolean {
    const value = this.values[field];
    if (value === undefined || value === null) return fallback;
    if (typeof value === "boolean") return value;
    this.issue(field, `${field} must be true or false`);
    return fallback;
  }

  /** A whole number, or null. */
  int(field: string): number | null {
    const value = this.values[field];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
    this.warnings.push(
      warning("invalid_number", `${field} isn't a whole number, so it wasn't migrated`),
    );
    return null;
  }

  /** An http or https web address, or null. Anything else is flagged, and kept as text where possible. */
  url(field: string): string | null {
    const value = this.text(field);
    if (value === null || HTTP_URL.test(value)) return value;
    this.keep(field, value);
    this.warnings.push(
      warning(
        "invalid_url",
        this.keepExtras
          ? `${field} isn't an http or https web address, so it was kept as an extra attribute`
          : `${field} isn't an http or https web address, so it wasn't migrated`,
      ),
    );
    return null;
  }

  /**
   * A date as YYYY-MM-DD, from DD/MM/YYYY (the current Hub's format) or
   * YYYY-MM-DD. "ongoing" means no date. Anything else is flagged, and kept as
   * text where possible.
   */
  date(field: string): string | null {
    const value = this.text(field);
    if (value === null || value.toLowerCase() === "ongoing") return null;
    const parsed = parseHubDate(value);
    if (parsed !== undefined) return parsed;
    this.keep(field, value);
    this.warnings.push(
      warning(
        "invalid_date",
        this.keepExtras
          ? `${field} isn't a date the migration can read, so it was kept as an extra attribute`
          : `${field} isn't a date the migration can read, so it wasn't migrated`,
      ),
    );
    return null;
  }

  /** A list of text items. `required` lists must be present (the current Hub's build fails without them). */
  list(field: string, required: boolean): string[] {
    const value = this.values[field];
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (const item of value as unknown[]) {
        if (typeof item === "string" && item.trim() !== "") items.push(item.trim());
        else if (typeof item === "number") items.push(String(item));
        else {
          this.warnings.push(
            warning("complex_value", `${field} has an item that isn't text, so it wasn't migrated`),
          );
        }
      }
      return items;
    }
    if (required) {
      this.issue(field, `${field} must be a list (it can be empty)`);
    } else if (value !== undefined && value !== null) {
      this.warnings.push(warning("complex_value", `${field} isn't a list, so it wasn't migrated`));
    }
    return [];
  }

  /** GitHub organisation names, dropping (and flagging) any that aren't valid. */
  githubOrgs(field: string): string[] {
    const names = this.list(field, false);
    const valid = names.filter((name) => GITHUB_NAME.test(name));
    if (valid.length < names.length) {
      this.warnings.push(
        warning(
          "invalid_github_org",
          `${names.length - valid.length} ${field} entries aren't valid GitHub organisation names, so they weren't migrated`,
        ),
      );
    }
    return valid;
  }

  /**
   * An ownership level key, with "_" read as "-" as on the current Hub. If
   * `fallback` is given and the field is unset, the fallback is used, as the
   * current Hub does for tools.
   */
  ownershipLevel(field: string, fallback?: string): string | null {
    const value = this.text(field);
    if (value !== null) return normaliseKey(value);
    if (fallback === undefined) return null;
    this.warnings.push(
      warning(
        "defaulted_value",
        `${field} isn't set, so the ${fallback} level is used, as on the current Hub`,
        false,
      ),
    );
    return fallback;
  }

  /** Engineering or business, or null. Other values are flagged. */
  toolKind(field: string): ToolKind | null {
    const value = this.text(field);
    if (value === null) return null;
    if (/business/i.test(value)) return "business";
    if (/engineering/i.test(value)) return "engineering";
    this.warnings.push(
      warning("unmapped_value", `${field} isn't engineering or business, so it wasn't migrated`),
    );
    return null;
  }

  /**
   * The identity migration status. Unset is "not started", as on the current
   * Hub. A value that can't be mapped is treated as in progress, kept as text
   * where possible, and flagged.
   */
  migrationStatus(field: string): MigrationStatus {
    const value = this.text(field);
    if (value === null || /not started/i.test(value)) return "not_started";
    if (/not applicable|^n\/a$/i.test(value)) return "not_applicable";
    if (/complete/i.test(value)) return "complete";
    // "Awaiting" means started, but waiting on another team (developer's decision).
    if (/progress|underway|migrating|awaiting/i.test(value)) return "in_progress";
    this.keep(field, value);
    this.warnings.push(
      warning(
        "unmapped_value",
        `${field} isn't a status the migration knows, so it is treated as in progress${
          this.keepExtras ? " and kept as an extra attribute" : ""
        }`,
      ),
    );
    return "in_progress";
  }

  /** Warns about fields this record type doesn't migrate. */
  checkFields(known: ReadonlySet<string>, ignored: ReadonlySet<string>): void {
    for (const field of Object.keys(this.values)) {
      if (known.has(field) || field === "key" || field === "id") continue;
      if (ignored.has(field)) {
        this.warnings.push(
          warning(
            "ignored_field",
            `${field} only set the current Hub's navigation, so it isn't migrated`,
            false,
          ),
        );
      } else {
        this.warnings.push(
          warning(
            "unknown_field",
            `${field} isn't a field the migration knows, so it wasn't migrated`,
          ),
        );
      }
    }
  }
}

/** A YAML key in kebab case: "_" becomes "-", as the current Hub reads ownership levels. */
export function normaliseKey(key: string): string {
  return key.trim().replace(/_/g, "-").toLowerCase();
}

/** Reads DD/MM/YYYY or YYYY-MM-DD as YYYY-MM-DD, or undefined if it isn't a real date. */
export function parseHubDate(value: string): string | undefined {
  const trimmed = value.trim();
  const british = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  const iso = british
    ? `${british[3] ?? ""}-${(british[2] ?? "").padStart(2, "0")}-${(british[1] ?? "").padStart(2, "0")}`
    : trimmed;
  return isCalendarDate(iso) ? iso : undefined;
}

/** A value kept as an extra attribute: text, with lists joined and anything nested as JSON. */
export function extraAttributeText(value: unknown): { text: string | undefined; complex: boolean } {
  if (value === undefined || value === null) return { text: undefined, complex: false };
  if (typeof value === "string") {
    const trimmed = value.trim();
    return { text: trimmed === "" ? undefined : trimmed, complex: false };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { text: String(value), complex: false };
  }
  if (
    Array.isArray(value) &&
    value.every((item) => ["string", "number", "boolean"].includes(typeof item))
  ) {
    return {
      text: (value as (string | number | boolean)[]).map(String).join(", "),
      complex: false,
    };
  }
  return { text: JSON.stringify(value), complex: true };
}
