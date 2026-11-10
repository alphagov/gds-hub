import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { capabilities, instances } from "./catalogue.js";
import { fk, httpUrlCheck, id, kebabCaseCheck, notOwnParentCheck, timestamps } from "./columns.js";

// Foreign keys on the join tables are named explicitly: the generated names
// would be longer than Postgres's 63-character limit and get truncated.

/** A product, team, service or community in GDS. */
export const productTeamServices = pgTable(
  "product_team_services",
  {
    id: id(),
    key: text("key").notNull().unique("product_team_services_key_unique"),
    slug: text("slug").notNull().unique("product_team_services_slug_unique"),
    name: text("name").notNull(),
    purpose: text("purpose"),
    url: text("url"),
    slackChannel: text("slack_channel"),
    slackChannelName: text("slack_channel_name"),
    teamEmailAddress: text("team_email_address"),
    // GitHub organisations the team's repositories are in.
    ghOrgs: text("gh_orgs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    escalationContact: text("escalation_contact"),
    // Set by a person: the date the content was last checked as accurate.
    lastReviewedAt: date("last_reviewed_at", { mode: "string" }),
    weight: integer("weight"),
    ...timestamps(),
  },
  (t) => [
    kebabCaseCheck("product_team_services_key_format", t.key),
    kebabCaseCheck("product_team_services_slug_format", t.slug),
    httpUrlCheck("product_team_services_url_format", t.url),
    httpUrlCheck("product_team_services_slack_channel_format", t.slackChannel),
    // Each organisation name is used in a GitHub link, so it must be a valid
    // GitHub name: letters and digits, with single hyphens between them.
    // - The text form of the array quotes any element with a comma, brace,
    //   quote or space, or that is empty, so the pattern rejects those too. It
    //   also rejects arrays with more than one dimension.
    // - Null elements print as NULL, which looks like a valid name, so they're
    //   checked separately. The CASE makes the pattern run first, because
    //   array_position raises an error on a multi-dimensional array.
    check(
      "product_team_services_gh_orgs_format",
      sql`CASE WHEN ${t.ghOrgs}::text ~ '^[{]([A-Za-z0-9]+(-[A-Za-z0-9]+)*(,[A-Za-z0-9]+(-[A-Za-z0-9]+)*)*)?[}]$'
        THEN array_position(${t.ghOrgs}, NULL) IS NULL
        ELSE false END`,
    ),
  ],
);

/** Which instances a product, team or service uses. */
export const productTeamServiceInstances = pgTable(
  "product_team_service_instances",
  {
    id: id(),
    productTeamServiceId: fk("product_team_service_id").notNull(),
    instanceId: fk("instance_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "pts_instances_pts_fk",
      columns: [t.productTeamServiceId],
      foreignColumns: [productTeamServices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pts_instances_instance_fk",
      columns: [t.instanceId],
      foreignColumns: [instances.id],
    }).onDelete("cascade"),
    unique("pts_instances_pts_id_instance_id_unique").on(t.productTeamServiceId, t.instanceId),
    index("pts_instances_instance_id_idx").on(t.instanceId),
  ],
);

/** Which capability an instance provides to which product, team or service. */
export const instanceCapabilities = pgTable(
  "instance_capabilities",
  {
    id: id(),
    instanceId: fk("instance_id").notNull(),
    capabilityId: fk("capability_id").notNull(),
    productTeamServiceId: fk("product_team_service_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "instance_capabilities_instance_fk",
      columns: [t.instanceId],
      foreignColumns: [instances.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "instance_capabilities_capability_fk",
      columns: [t.capabilityId],
      foreignColumns: [capabilities.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "instance_capabilities_pts_fk",
      columns: [t.productTeamServiceId],
      foreignColumns: [productTeamServices.id],
    }).onDelete("cascade"),
    unique("instance_capabilities_instance_capability_pts_unique").on(
      t.instanceId,
      t.capabilityId,
      t.productTeamServiceId,
    ),
    index("instance_capabilities_capability_id_idx").on(t.capabilityId),
    index("instance_capabilities_pts_id_idx").on(t.productTeamServiceId),
  ],
);

/** A directorate or other business unit. Units can sit inside a parent unit. */
export const businessUnits = pgTable(
  "business_units",
  {
    id: id(),
    key: text("key").notNull().unique("business_units_key_unique"),
    name: text("name").notNull(),
    // For example "directorate". Other values exist in the current Hub data.
    level: text("level"),
    description: text("description"),
    lead: text("lead"),
    url: text("url"),
    escalationContact: text("escalation_contact"),
    parentId: fk("parent_id"),
    weight: integer("weight"),
    ...timestamps(),
  },
  (t) => [
    kebabCaseCheck("business_units_key_format", t.key),
    httpUrlCheck("business_units_url_format", t.url),
    foreignKey({
      name: "business_units_parent_fk",
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    notOwnParentCheck("business_units_not_own_parent", t.parentId, t.id),
    index("business_units_parent_id_idx").on(t.parentId),
  ],
);

/** Which products, teams and services each business unit operates. */
export const businessUnitProductTeamServices = pgTable(
  "business_unit_product_team_services",
  {
    id: id(),
    businessUnitId: fk("business_unit_id").notNull(),
    productTeamServiceId: fk("product_team_service_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "bu_pts_business_unit_fk",
      columns: [t.businessUnitId],
      foreignColumns: [businessUnits.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bu_pts_pts_fk",
      columns: [t.productTeamServiceId],
      foreignColumns: [productTeamServices.id],
    }).onDelete("cascade"),
    unique("bu_pts_business_unit_id_pts_id_unique").on(t.businessUnitId, t.productTeamServiceId),
    index("bu_pts_pts_id_idx").on(t.productTeamServiceId),
  ],
);
