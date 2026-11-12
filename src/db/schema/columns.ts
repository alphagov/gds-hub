import { sql, type Column } from "drizzle-orm";
import { bigint, check, timestamp } from "drizzle-orm/pg-core";

/** Primary key: a bigint identity column the database always assigns. */
export const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

/** A bigint column for a foreign key. Add `.references(...)` at the call site. */
export const fk = (name: string) => bigint(name, { mode: "number" });

/** created_at and updated_at, both timestamptz and set by the database. */
export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Lower-case letters and digits in words separated by single hyphens, for
 * example "pipeline-pilot". This is the identifier rule the current Hub
 * enforces on its YAML keys.
 */
export const kebabCaseCheck = (name: string, column: Column) =>
  check(name, sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`);

/** Stops a row from being its own parent. */
export const notOwnParentCheck = (name: string, parent: Column, self: Column) =>
  check(name, sql`${parent} IS NULL OR ${parent} <> ${self}`);

/**
 * An absolute http or https URL with no spaces or control characters. Rejects
 * every other scheme (for example javascript: or data:), because these columns
 * are shown as links.
 */
export const httpUrlCheck = (name: string, column: Column) =>
  check(name, sql`${column} IS NULL OR ${column} ~* '^https?://[^[:space:][:cntrl:]]+$'`);

/**
 * A path on this site: one leading slash, no second slash or backslash after
 * it, and no spaces or control characters, so a browser can't read it as
 * another site's address. Matches SITE_PATH in src/validation/catalogue.ts.
 * The backslash is checked with chr(92), so the pattern needs no escaping.
 * 2048 is MAX_SITE_PATH_LENGTH.
 */
export const sitePathCheck = (name: string, column: Column) =>
  check(
    name,
    sql`${column} ~ '^/([^/[:space:][:cntrl:]][^[:space:][:cntrl:]]*)?$'
      AND strpos(${column}, chr(92)) = 0
      AND length(${column}) <= 2048`,
  );
