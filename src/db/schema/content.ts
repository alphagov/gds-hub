import { sql } from "drizzle-orm";
import { check, date, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { fk, id, kebabCaseCheck, timestamps } from "./columns.js";
import { auditAction, contentStatus, pageType } from "./enums.js";
import { productTeamServices } from "./organisation.js";

/**
 * Long-form markdown content: policies, service guides, guidance, general
 * articles and "What's new" posts. A page can belong to the product, team or
 * service that owns it (for example a shared service's guidance).
 */
export const pages = pgTable(
  "pages",
  {
    id: id(),
    slug: varchar("slug", { length: 160 }).notNull().unique("pages_slug_unique"),
    title: varchar("title", { length: 255 }).notNull(),
    pageType: pageType("page_type").notNull(),
    summary: text("summary"),
    // Always rendered through src/lib/markdown.ts.
    bodyMarkdown: text("body_markdown").notNull(),
    ownerName: varchar("owner_name", { length: 255 }),
    ownerContact: text("owner_contact"),
    productTeamServiceId: fk("product_team_service_id").references(() => productTeamServices.id, {
      onDelete: "restrict",
    }),
    status: contentStatus("status").notNull().default("published"),
    // Set by a person: the date the content was last checked as accurate.
    lastReviewedAt: date("last_reviewed_at", { mode: "string" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    kebabCaseCheck("pages_slug_format", t.slug),
    index("pages_product_team_service_id_idx").on(t.productTeamServiceId),
    index("pages_page_type_idx").on(t.pageType),
  ],
);

/**
 * One row per change to any record. entity_id has no foreign key so the
 * history outlives the record it describes.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    // Singular record type, for example "instance" or "page".
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: fk("entity_id").notNull(),
    action: auditAction("action").notNull(),
    // The full row before and after the change.
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    // Property names that changed.
    changedFields: jsonb("changed_fields")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // MVP: the editor's email. A display name once there is an identity provider.
    actorName: varchar("actor_name", { length: 255 }).notNull(),
    // MVP: the email from the verified Lambda@Edge JWT, or "system:..." for
    // the data migration ("system:data_migration") and the seed.
    actorSubject: varchar("actor_subject", { length: 255 }).notNull(),
    requestId: varchar("request_id", { length: 128 }),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "audit_log_actor_present",
      sql`length(trim(${t.actorName})) > 0 AND length(trim(${t.actorSubject})) > 0`,
    ),
    check("audit_log_changed_fields_is_array", sql`jsonb_typeof(${t.changedFields}) = 'array'`),
    check(
      "audit_log_values_match_action",
      sql`(${t.action} = 'create' AND ${t.before} IS NULL AND ${t.after} IS NOT NULL)
        OR (${t.action} = 'delete' AND ${t.before} IS NOT NULL AND ${t.after} IS NULL)
        OR (${t.action} IN ('update', 'publish', 'unpublish')
            AND ${t.before} IS NOT NULL AND ${t.after} IS NOT NULL)`,
    ),
    index("audit_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ],
);
