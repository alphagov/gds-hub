import {
  businessUnitFields,
  capabilityFields,
  contractFields,
  instanceFields,
  ownershipLevelFields,
  pageFields,
  productTeamServiceFields,
  redirectFields,
  toolFields,
} from "../validation/catalogue.js";
import { TARGET_ENTITIES, type MigrationRecord, type TargetEntity } from "./records.js";

/**
 * Turns migration records into the values the repositories write: each
 * table's own columns, with references by key replaced by IDs. Pure: the
 * loader gives it the IDs of records already loaded.
 */

/** The database ID of a loaded record, or undefined if it hasn't been loaded. */
export type IdLookup = (entity: TargetEntity, key: string) => number | undefined;

/** A record refers to one with no ID, so it can't be loaded yet. Names keys, never values. */
export class LoadMappingError extends Error {
  override readonly name = "LoadMappingError";
}

export interface CapabilityToolRow {
  readonly capabilityId: number;
  readonly toolId: number;
  readonly position: number;
}

export interface TeamInstanceRow {
  readonly productTeamServiceId: number;
  readonly instanceId: number;
}

export interface UnitTeamRow {
  readonly businessUnitId: number;
  readonly productTeamServiceId: number;
}

export interface LinkRows {
  readonly capabilityTools: readonly CapabilityToolRow[];
  readonly productTeamServiceInstances: readonly TeamInstanceRow[];
  readonly businessUnitProductTeamServices: readonly UnitTeamRow[];
}

export interface LoadMapping {
  /**
   * The records in the order to load them: every record a record refers to
   * comes first, and each business unit comes after its parent.
   */
  loadOrder(): MigrationRecord[];
  /** The column values to write for a record. */
  columnValues(record: MigrationRecord, idOf: IdLookup): Record<string, unknown>;
  /** The links between records, as join table rows. */
  linkRows(idOf: IdLookup): LinkRows;
}

/** The columns each record type writes, from the shared schemas. */
const COLUMNS: Readonly<Record<TargetEntity, readonly string[]>> = {
  ownership_level: Object.keys(ownershipLevelFields),
  tool: Object.keys(toolFields),
  contract: Object.keys(contractFields),
  instance: Object.keys(instanceFields),
  capability: Object.keys(capabilityFields),
  product_team_service: Object.keys(productTeamServiceFields),
  business_unit: Object.keys(businessUnitFields),
  page: Object.keys(pageFields),
  redirect: Object.keys(redirectFields),
};

function entityName(entity: TargetEntity): string {
  return entity.replace(/_/g, " ");
}

function keysIn(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function keyIn(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** A published date as midnight UTC on that day. */
function publishedAt(value: unknown): Date | null {
  return typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : null;
}

export function createLoadMapping(records: readonly MigrationRecord[]): LoadMapping {
  // Each business unit's parent: the unit that lists it as a child.
  const parentOf = new Map<string, string>();
  for (const record of records) {
    if (record.targetEntity !== "business_unit") continue;
    for (const child of keysIn(record.fields.childKeys)) {
      if (!parentOf.has(child)) parentOf.set(child, record.key);
    }
  }

  // Each tool's placeholder instance, which a team's "uses" links to.
  const placeholderOf = new Map<string, string>();
  for (const record of records) {
    if (record.targetEntity !== "instance" || record.fields.isPlaceholder !== true) continue;
    const tool = keyIn(record.fields.toolKey);
    if (tool !== null) placeholderOf.set(tool, record.key);
  }

  const required = (
    idOf: IdLookup,
    from: MigrationRecord,
    entity: TargetEntity,
    key: string,
  ): number => {
    const id = idOf(entity, key);
    if (id === undefined) {
      throw new LoadMappingError(
        `${entityName(from.targetEntity)} ${from.key} refers to ${entityName(entity)} ${key}, which hasn't been loaded`,
      );
    }
    return id;
  };

  const optional = (
    idOf: IdLookup,
    from: MigrationRecord,
    entity: TargetEntity,
    key: string | null,
  ): number | null => (key === null ? null : required(idOf, from, entity, key));

  return {
    loadOrder() {
      const byEntity = TARGET_ENTITIES.flatMap((entity) =>
        records.filter((record) => record.targetEntity === entity),
      );
      const units = byEntity.filter((record) => record.targetEntity === "business_unit");
      const unitsByKey = new Map(units.map((unit) => [unit.key, unit]));
      const orderedUnits: MigrationRecord[] = [];
      const placed = new Set<string>();
      const place = (unit: MigrationRecord, visiting: Set<string>): void => {
        if (placed.has(unit.key) || visiting.has(unit.key)) return;
        visiting.add(unit.key);
        const parent = parentOf.get(unit.key);
        const parentUnit = parent === undefined ? undefined : unitsByKey.get(parent);
        if (parentUnit !== undefined) place(parentUnit, visiting);
        placed.add(unit.key);
        orderedUnits.push(unit);
      };
      for (const unit of units) place(unit, new Set());

      const firstUnit = byEntity.findIndex((record) => record.targetEntity === "business_unit");
      if (firstUnit === -1) return byEntity;
      return [
        ...byEntity.slice(0, firstUnit),
        ...orderedUnits,
        ...byEntity.slice(firstUnit + units.length),
      ];
    },

    columnValues(record, idOf) {
      const { fields } = record;
      const values: Record<string, unknown> = {};
      for (const column of COLUMNS[record.targetEntity]) values[column] = fields[column];

      switch (record.targetEntity) {
        case "contract":
          values.toolId = required(idOf, record, "tool", keyIn(fields.toolKey) ?? "");
          break;
        case "instance":
          values.toolId = required(idOf, record, "tool", keyIn(fields.toolKey) ?? "");
          values.contractId = optional(idOf, record, "contract", keyIn(fields.contractKey));
          values.ownershipLevelId = optional(
            idOf,
            record,
            "ownership_level",
            keyIn(fields.ownershipLevelKey),
          );
          values.targetOwnershipLevelId = optional(
            idOf,
            record,
            "ownership_level",
            keyIn(fields.targetOwnershipLevelKey),
          );
          break;
        case "business_unit":
          values.parentId = optional(
            idOf,
            record,
            "business_unit",
            parentOf.get(record.key) ?? null,
          );
          break;
        case "page":
          values.publishedAt = publishedAt(fields.publishedAt);
          values.bodyMarkdown = record.bodyMarkdown ?? "";
          break;
        default:
          break;
      }
      return values;
    },

    linkRows(idOf) {
      const capabilityTools: CapabilityToolRow[] = [];
      const productTeamServiceInstances: TeamInstanceRow[] = [];
      const businessUnitProductTeamServices: UnitTeamRow[] = [];
      const seen = new Set<string>();
      /** Whether a link is new, so a key listed twice is only linked once. */
      const first = (id: string): boolean => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      };

      for (const record of records) {
        if (record.targetEntity === "capability") {
          const capabilityId = required(idOf, record, "capability", record.key);
          let position = 0;
          for (const tool of keysIn(record.fields.toolKeys)) {
            const toolId = required(idOf, record, "tool", tool);
            if (!first(`capability:${String(capabilityId)}:${String(toolId)}`)) continue;
            capabilityTools.push({ capabilityId, toolId, position });
            position += 1;
          }
        } else if (record.targetEntity === "product_team_service") {
          const productTeamServiceId = required(idOf, record, "product_team_service", record.key);
          for (const tool of keysIn(record.fields.usesToolKeys)) {
            const instanceId = required(idOf, record, "instance", placeholderOf.get(tool) ?? tool);
            if (!first(`team:${String(productTeamServiceId)}:${String(instanceId)}`)) continue;
            productTeamServiceInstances.push({ productTeamServiceId, instanceId });
          }
        } else if (record.targetEntity === "business_unit") {
          const businessUnitId = required(idOf, record, "business_unit", record.key);
          for (const team of keysIn(record.fields.operatesKeys)) {
            const productTeamServiceId = required(idOf, record, "product_team_service", team);
            if (!first(`unit:${String(businessUnitId)}:${String(productTeamServiceId)}`)) continue;
            businessUnitProductTeamServices.push({ businessUnitId, productTeamServiceId });
          }
        }
      }
      return { capabilityTools, productTeamServiceInstances, businessUnitProductTeamServices };
    },
  };
}
