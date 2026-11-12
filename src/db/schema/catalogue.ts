import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { fk, httpUrlCheck, id, kebabCaseCheck, timestamps } from "./columns.js";
import { engineeringOrBusinessTool, migrationStatus } from "./enums.js";

// Foreign keys between entities use RESTRICT, so a record that is still in use
// can't be deleted by accident. Rows in join tables are removed with either
// parent (CASCADE).

/** The company that makes a tool. */
export const vendors = pgTable(
  "vendors",
  {
    id: id(),
    slug: text("slug").notNull().unique("vendors_slug_unique"),
    name: text("name").notNull().unique("vendors_name_unique"),
    description: text("description"),
    url: text("url"),
    supportContact: text("support_contact"),
    dataProtectionContact: text("data_protection_contact"),
    ...timestamps(),
  },
  (t) => [kebabCaseCheck("vendors_slug_format", t.slug), httpUrlCheck("vendors_url_format", t.url)],
);

/** The company GDS buys a tool through. It can differ from the vendor (a reseller). */
export const suppliers = pgTable(
  "suppliers",
  {
    id: id(),
    name: text("name").notNull().unique("suppliers_name_unique"),
    url: text("url"),
    accountManagerName: text("account_manager_name"),
    accountManagerEmail: text("account_manager_email"),
    supportContact: text("support_contact"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [httpUrlCheck("suppliers_url_format", t.url)],
);

/** A software product, independent of how or where GDS uses it. */
export const tools = pgTable(
  "tools",
  {
    id: id(),
    key: text("key").notNull().unique("tools_key_unique"),
    slug: text("slug").notNull().unique("tools_slug_unique"),
    name: text("name").notNull(),
    description: text("description"),
    engineeringOrBusinessTool: engineeringOrBusinessTool("engineering_or_business_tool"),
    // Optional: the current Hub data doesn't record vendors.
    vendorId: fk("vendor_id").references(() => vendors.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    kebabCaseCheck("tools_key_format", t.key),
    kebabCaseCheck("tools_slug_format", t.slug),
    index("tools_vendor_id_idx").on(t.vendorId),
  ],
);

/** Which suppliers can supply which tools. */
export const supplierTools = pgTable(
  "supplier_tools",
  {
    id: id(),
    supplierId: fk("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    toolId: fk("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    unique("supplier_tools_supplier_id_tool_id_unique").on(t.supplierId, t.toolId),
    index("supplier_tools_tool_id_idx").on(t.toolId),
  ],
);

/** A licence agreement for a tool with a supplier. */
export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    toolId: fk("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "restrict" }),
    // Optional: the current Hub data doesn't record suppliers.
    supplierId: fk("supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    licenseType: text("license_type"),
    licenseTerms: text("license_terms"),
    procurementRoute: text("procurement_route"),
    cost: text("cost"),
    costModel: text("cost_model"),
    commercials: text("commercials"),
    dataProtectionAndSecurity: text("data_protection_and_security"),
    operationalPolicy: text("operational_policy"),
    totalUsers: text("total_users"),
    renewalNotes: text("renewal_notes"),
    ...timestamps(),
  },
  (t) => [
    // Lets instances check that their contract is for the same tool.
    unique("contracts_id_tool_id_unique").on(t.id, t.toolId),
    index("contracts_tool_id_idx").on(t.toolId),
    index("contracts_supplier_id_idx").on(t.supplierId),
    check(
      "contracts_dates_in_order",
      sql`${t.startDate} IS NULL OR ${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

/** Engineering Enablement's ownership maturity levels, such as "undocumented". */
export const ownershipLevels = pgTable(
  "ownership_levels",
  {
    id: id(),
    key: text("key").notNull().unique("ownership_levels_key_unique"),
    name: text("name").notNull(),
    definition: text("definition"),
    description: text("description"),
    targetState: text("target_state"),
    weight: integer("weight"),
    hideInNavigation: boolean("hide_in_navigation").notNull().default(false),
    ...timestamps(),
  },
  (t) => [kebabCaseCheck("ownership_levels_key_format", t.key)],
);

/** One deployment, account or tenant of a tool, for example a SaaS workspace. */
export const instances = pgTable(
  "instances",
  {
    id: id(),
    key: text("key").notNull().unique("instances_key_unique"),
    slug: text("slug").notNull().unique("instances_slug_unique"),
    name: text("name").notNull(),
    toolId: fk("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "restrict" }),
    // Optional: the current Hub data doesn't record contracts.
    contractId: fk("contract_id"),
    url: text("url"),
    description: text("description"),
    gettingAccess: text("getting_access"),
    management: text("management"),
    authentication: text("authentication"),
    userProvisioning: text("user_provisioning"),
    support: text("support"),
    escalationContact: text("escalation_contact"),
    supportedByGdsSoftwareServiceDesk: boolean("supported_by_gds_software_service_desk")
      .notNull()
      .default(false),
    notInUse: boolean("not_in_use").notNull().default(false),
    // Stands in for a tool's own settings when the tool has no real instances yet.
    isPlaceholder: boolean("is_placeholder").notNull().default(false),
    migrationStatus: migrationStatus("migration_status").notNull().default("not_started"),
    migrationDate: date("migration_date", { mode: "string" }),
    ownershipLevelId: fk("ownership_level_id").references(() => ownershipLevels.id, {
      onDelete: "restrict",
    }),
    targetOwnershipLevelId: fk("target_ownership_level_id").references(() => ownershipLevels.id, {
      onDelete: "restrict",
    }),
    // Any other attributes, shown as extra rows on the instance page.
    extraAttributes: jsonb("extra_attributes")
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Set by a person: the date the content was last checked as accurate.
    // updated_at, by contrast, changes on every write.
    lastReviewedAt: date("last_reviewed_at", { mode: "string" }),
    ...timestamps(),
  },
  (t) => [
    kebabCaseCheck("instances_key_format", t.key),
    kebabCaseCheck("instances_slug_format", t.slug),
    // A JSON object whose values are all text, as the TypeScript type says.
    // Strict mode stops arrays being unwrapped, so ["x"] isn't treated as
    // text. The CASE means the path only runs on objects (strict mode raises
    // an error on anything else).
    check(
      "instances_extra_attributes_format",
      sql`CASE WHEN jsonb_typeof(${t.extraAttributes}) = 'object'
        THEN NOT jsonb_path_exists(${t.extraAttributes}, 'strict $.* ? (@.type() != "string")')
        ELSE false END`,
    ),
    httpUrlCheck("instances_url_format", t.url),
    // A contract is optional, but if there is one it must be for this tool.
    // (With MATCH SIMPLE, a null contract_id skips the check.)
    foreignKey({
      name: "instances_contract_tool_fk",
      columns: [t.contractId, t.toolId],
      foreignColumns: [contracts.id, contracts.toolId],
    }).onDelete("restrict"),
    index("instances_tool_id_idx").on(t.toolId),
    index("instances_contract_id_idx").on(t.contractId),
    index("instances_ownership_level_id_idx").on(t.ownershipLevelId),
    index("instances_target_ownership_level_id_idx").on(t.targetOwnershipLevelId),
  ],
);

/** A functional capability, such as "accessibility testing", grouped by name. */
export const capabilities = pgTable(
  "capabilities",
  {
    id: id(),
    key: text("key").notNull().unique("capabilities_key_unique"),
    name: text("name").notNull(),
    description: text("description"),
    // A plain label, not an entity, as in the current Hub.
    groupName: text("group_name"),
    // Shown as "Plans" on the capability page.
    comment: text("comment"),
    weight: integer("weight"),
    hideInNavigation: boolean("hide_in_navigation").notNull().default(false),
    ...timestamps(),
  },
  (t) => [kebabCaseCheck("capabilities_key_format", t.key)],
);

/** Which tools provide which capabilities. */
export const capabilityTools = pgTable(
  "capability_tools",
  {
    id: id(),
    capabilityId: fk("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "cascade" }),
    toolId: fk("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    position: integer("position"),
    ...timestamps(),
  },
  (t) => [
    unique("capability_tools_capability_id_tool_id_unique").on(t.capabilityId, t.toolId),
    index("capability_tools_tool_id_idx").on(t.toolId),
  ],
);
