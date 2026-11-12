import { pgEnum } from "drizzle-orm/pg-core";

// Adding a value to a Postgres enum is backward compatible (ALTER TYPE ... ADD
// VALUE). Removing or renaming one is not, so treat these lists as append-only.

/**
 * Where an instance is in the move to DSIT identity. not_applicable is for
 * tools that won't move, as recorded on the current Hub.
 */
export const migrationStatus = pgEnum("migration_status", [
  "not_started",
  "in_progress",
  "complete",
  "not_applicable",
]);

export const engineeringOrBusinessTool = pgEnum("engineering_or_business_tool", [
  "engineering",
  "business",
]);

/** The kind of long-form content page. whats_new is for dated "What's new" posts. */
export const pageType = pgEnum("page_type", [
  "policy",
  "service_guide",
  "guidance",
  "general",
  "whats_new",
]);

/** Saves publish straight away in the MVP. Drafts are for later. */
export const contentStatus = pgEnum("content_status", ["draft", "published"]);

export const auditAction = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "publish",
  "unpublish",
]);
