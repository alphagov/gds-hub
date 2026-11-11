import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Database } from "./client.js";
import {
  auditLog,
  businessUnitProductTeamServices,
  businessUnits,
  capabilities,
  capabilityTools,
  contracts,
  instanceCapabilities,
  instances,
  ownershipLevels,
  pages,
  productTeamServiceInstances,
  productTeamServices,
  supplierTools,
  suppliers,
  tools,
  vendors,
} from "./schema/index.js";

/** Every table the app's migrations create. A test checks this against the database. */
export const APP_TABLES: readonly PgTable[] = [
  vendors,
  suppliers,
  tools,
  supplierTools,
  contracts,
  ownershipLevels,
  instances,
  capabilities,
  capabilityTools,
  productTeamServices,
  productTeamServiceInstances,
  instanceCapabilities,
  businessUnits,
  businessUnitProductTeamServices,
  pages,
  auditLog,
];

/** Views the app's migrations create (drizzle/0001_search.sql). */
export const APP_VIEW_NAMES: readonly string[] = ["search_index"];

/** Tables and views the app's migrations create, by name. */
export const APP_RELATION_NAMES: ReadonlySet<string> = new Set([
  ...APP_TABLES.map((table) => getTableName(table)),
  ...APP_VIEW_NAMES,
]);

/** The name of the first app table that has any rows, or undefined if they are all empty. */
export async function firstNonEmptyTable(
  db: Pick<Database, "$count">,
): Promise<string | undefined> {
  for (const table of APP_TABLES) {
    if ((await db.$count(table)) > 0) return getTableName(table);
  }
  return undefined;
}
