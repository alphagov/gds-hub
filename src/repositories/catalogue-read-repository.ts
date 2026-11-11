import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../db/client.js";
import type { EntityType } from "../db/entity-types.js";
import {
  businessUnitProductTeamServices,
  businessUnits,
  capabilities,
  capabilityTools,
  contracts,
  instanceCapabilities,
  instances,
  ownershipLevels,
  productTeamServiceInstances,
  productTeamServices,
  supplierTools,
  suppliers,
  tools,
  vendors,
} from "../db/schema/index.js";
import { toRepositoryError } from "./errors.js";
import { runReadOnly, type Executor } from "./executor.js";
import type {
  BusinessUnitSummary,
  CapabilitySummary,
  ContractDetail,
  InstanceDetail,
  InstanceWithOwnership,
  ProductTeamServiceSummary,
  ProductTeamServiceWithUnits,
  SupplierRecord,
  ToolDetail,
  ToolSummary,
  VendorRecord,
} from "./read-models.js";

export interface CatalogueReadRepository {
  /** A tool and everything linked to it, by the tool's slug. Undefined if there's no such tool. */
  getToolDetail(slug: string): Promise<ToolDetail | undefined>;
  /** An instance and everything linked to it, by its slug. Undefined if there's no such instance. */
  getInstanceDetail(slug: string): Promise<InstanceDetail | undefined>;
}

const currentLevel = alias(ownershipLevels, "current_ownership_level");
const targetLevel = alias(ownershipLevels, "target_ownership_level");

const teamSummaryFields = {
  id: productTeamServices.id,
  key: productTeamServices.key,
  slug: productTeamServices.slug,
  name: productTeamServices.name,
};

const capabilitySummaryFields = {
  id: capabilities.id,
  key: capabilities.key,
  name: capabilities.name,
  groupName: capabilities.groupName,
};

async function instancesWithOwnership(
  reader: Executor,
  where: SQL,
): Promise<InstanceWithOwnership[]> {
  const rows = await reader
    .select({
      instance: instances,
      ownershipLevel: { id: currentLevel.id, key: currentLevel.key, name: currentLevel.name },
      targetOwnershipLevel: { id: targetLevel.id, key: targetLevel.key, name: targetLevel.name },
    })
    .from(instances)
    .leftJoin(currentLevel, eq(instances.ownershipLevelId, currentLevel.id))
    .leftJoin(targetLevel, eq(instances.targetOwnershipLevelId, targetLevel.id))
    .where(where)
    .orderBy(asc(instances.name), asc(instances.id));
  return rows.map((row) => ({
    ...row.instance,
    ownershipLevel: row.ownershipLevel,
    targetOwnershipLevel: row.targetOwnershipLevel,
  }));
}

async function contractsWithSupplier(reader: Executor, where: SQL): Promise<ContractDetail[]> {
  const rows = await reader
    .select({
      contract: contracts,
      supplier: { id: suppliers.id, name: suppliers.name, url: suppliers.url },
    })
    .from(contracts)
    .innerJoin(suppliers, eq(contracts.supplierId, suppliers.id))
    .where(where)
    .orderBy(sql`${contracts.startDate} DESC NULLS LAST`, asc(contracts.id));
  return rows.map((row) => ({ ...row.contract, supplier: row.supplier }));
}

/** Adds each team's business units, in name order. */
async function withBusinessUnits(
  reader: Executor,
  teams: readonly ProductTeamServiceSummary[],
): Promise<ProductTeamServiceWithUnits[]> {
  if (teams.length === 0) return [];
  const links = await reader
    .select({
      productTeamServiceId: businessUnitProductTeamServices.productTeamServiceId,
      id: businessUnits.id,
      key: businessUnits.key,
      name: businessUnits.name,
    })
    .from(businessUnitProductTeamServices)
    .innerJoin(businessUnits, eq(businessUnitProductTeamServices.businessUnitId, businessUnits.id))
    .where(
      inArray(
        businessUnitProductTeamServices.productTeamServiceId,
        teams.map((team) => team.id),
      ),
    )
    .orderBy(asc(businessUnits.name), asc(businessUnits.id));

  const unitsByTeam = new Map<number, BusinessUnitSummary[]>();
  for (const { productTeamServiceId, ...unit } of links) {
    const units = unitsByTeam.get(productTeamServiceId) ?? [];
    units.push(unit);
    unitsByTeam.set(productTeamServiceId, units);
  }
  return teams.map((team) => ({ ...team, businessUnits: unitsByTeam.get(team.id) ?? [] }));
}

async function loadToolDetail(reader: Executor, slug: string): Promise<ToolDetail | undefined> {
  const [tool] = await reader.select().from(tools).where(eq(tools.slug, slug));
  if (tool === undefined) return undefined;

  let vendor: VendorRecord | null = null;
  if (tool.vendorId !== null) {
    const [row] = await reader.select().from(vendors).where(eq(vendors.id, tool.vendorId));
    vendor = row ?? null;
  }

  const supplierRows = await reader
    .select({ supplier: suppliers })
    .from(supplierTools)
    .innerJoin(suppliers, eq(supplierTools.supplierId, suppliers.id))
    .where(eq(supplierTools.toolId, tool.id))
    .orderBy(asc(suppliers.name), asc(suppliers.id));
  const toolSuppliers: SupplierRecord[] = supplierRows.map((row) => row.supplier);

  const toolCapabilities: CapabilitySummary[] = await reader
    .select(capabilitySummaryFields)
    .from(capabilityTools)
    .innerJoin(capabilities, eq(capabilityTools.capabilityId, capabilities.id))
    .where(eq(capabilityTools.toolId, tool.id))
    .orderBy(
      sql`${capabilityTools.position} ASC NULLS LAST`,
      asc(capabilities.name),
      asc(capabilities.id),
    );

  // Teams link to instances, not tools: a team using two of the tool's
  // instances is still listed once.
  const teamsUsingTool: ProductTeamServiceSummary[] = await reader
    .select(teamSummaryFields)
    .from(productTeamServices)
    .where(
      inArray(
        productTeamServices.id,
        reader
          .select({ id: productTeamServiceInstances.productTeamServiceId })
          .from(productTeamServiceInstances)
          .innerJoin(instances, eq(productTeamServiceInstances.instanceId, instances.id))
          .where(eq(instances.toolId, tool.id)),
      ),
    )
    .orderBy(asc(productTeamServices.name), asc(productTeamServices.id));

  return {
    tool,
    vendor,
    suppliers: toolSuppliers,
    contracts: await contractsWithSupplier(reader, eq(contracts.toolId, tool.id)),
    capabilities: toolCapabilities,
    instances: await instancesWithOwnership(reader, eq(instances.toolId, tool.id)),
    productTeamServices: await withBusinessUnits(reader, teamsUsingTool),
  };
}

async function loadInstanceDetail(
  reader: Executor,
  slug: string,
): Promise<InstanceDetail | undefined> {
  const [found] = await instancesWithOwnership(reader, eq(instances.slug, slug));
  if (found === undefined) return undefined;
  const { ownershipLevel, targetOwnershipLevel, ...instance } = found;

  const [tool]: ToolSummary[] = await reader
    .select({ id: tools.id, key: tools.key, slug: tools.slug, name: tools.name })
    .from(tools)
    .where(eq(tools.id, instance.toolId));
  // The foreign key guarantees the tool exists.
  if (tool === undefined) throw new Error("the instance's tool was not found");

  let contract: ContractDetail | null = null;
  if (instance.contractId !== null) {
    const [row] = await contractsWithSupplier(reader, eq(contracts.id, instance.contractId));
    contract = row ?? null;
  }

  const teams: ProductTeamServiceSummary[] = await reader
    .select(teamSummaryFields)
    .from(productTeamServiceInstances)
    .innerJoin(
      productTeamServices,
      eq(productTeamServiceInstances.productTeamServiceId, productTeamServices.id),
    )
    .where(eq(productTeamServiceInstances.instanceId, instance.id))
    .orderBy(asc(productTeamServices.name), asc(productTeamServices.id));

  const provided = await reader
    .select({ capability: capabilitySummaryFields, productTeamService: teamSummaryFields })
    .from(instanceCapabilities)
    .innerJoin(capabilities, eq(instanceCapabilities.capabilityId, capabilities.id))
    .innerJoin(
      productTeamServices,
      eq(instanceCapabilities.productTeamServiceId, productTeamServices.id),
    )
    .where(eq(instanceCapabilities.instanceId, instance.id))
    .orderBy(asc(capabilities.name), asc(productTeamServices.name), asc(instanceCapabilities.id));

  return {
    instance,
    tool,
    contract,
    ownershipLevel,
    targetOwnershipLevel,
    productTeamServices: await withBusinessUnits(reader, teams),
    capabilities: provided,
  };
}

/**
 * Read models are always loaded from the pool, each in its own snapshot, so
 * they're consistent even while other transactions change the records.
 */
export function createCatalogueReadRepository(db: Database): CatalogueReadRepository {
  const load = async <R>(
    entityType: EntityType,
    work: (reader: Executor) => Promise<R>,
  ): Promise<R> => {
    try {
      return await runReadOnly(db, work);
    } catch (error) {
      throw toRepositoryError(error, entityType, "read");
    }
  };

  return {
    getToolDetail: (slug) => load("tool", (reader) => loadToolDetail(reader, slug)),
    getInstanceDetail: (slug) => load("instance", (reader) => loadInstanceDetail(reader, slug)),
  };
}
