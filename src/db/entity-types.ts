import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/**
 * The audit_log entity_type for each table: the singular record type, for
 * example "instance" or "page". Every table except audit_log is listed.
 */
export const ENTITY_TYPE_BY_TABLE = {
  vendors: "vendor",
  suppliers: "supplier",
  tools: "tool",
  supplier_tools: "supplier_tool",
  contracts: "contract",
  ownership_levels: "ownership_level",
  instances: "instance",
  capabilities: "capability",
  capability_tools: "capability_tool",
  product_team_services: "product_team_service",
  product_team_service_instances: "product_team_service_instance",
  instance_capabilities: "instance_capability",
  business_units: "business_unit",
  business_unit_product_team_services: "business_unit_product_team_service",
  pages: "page",
} as const;

export type AuditedTableName = keyof typeof ENTITY_TYPE_BY_TABLE;
export type EntityType = (typeof ENTITY_TYPE_BY_TABLE)[AuditedTableName];

/** The audit_log entity_type for a table. Throws for a table that isn't audited. */
export function entityTypeOf(table: PgTable): EntityType {
  const name = getTableName(table);
  if (!Object.hasOwn(ENTITY_TYPE_BY_TABLE, name)) {
    throw new Error(`table "${name}" has no audit entity type`);
  }
  return ENTITY_TYPE_BY_TABLE[name as AuditedTableName];
}
