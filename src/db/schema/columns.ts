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
