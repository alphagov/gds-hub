import { asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias, type PgColumn } from "drizzle-orm/pg-core";
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
  BusinessUnitDetail,
  BusinessUnitSummary,
  BusinessUnitWithTeams,
  CapabilityDetail,
  CapabilitySummary,
  ContractDetail,
  InstanceDetail,
  InstanceOfTool,
  InstanceWithOwnership,
  ProductTeamServiceDetail,
  ProductTeamServiceListEntry,
  ProductTeamServiceSummary,
  ProductTeamServiceWithUnits,
  ServiceDirectory,
  SupplierRecord,
  ToolDetail,
  ToolListEntry,
  ToolSummary,
  VendorDetail,
  VendorRecord,
} from "./read-models.js";

export interface CatalogueReadRepository {
  /** A tool and everything linked to it, by the tool's slug. Undefined if there's no such tool. */
  getToolDetail(slug: string): Promise<ToolDetail | undefined>;
  /** An instance and everything linked to it, by its slug. Undefined if there's no such instance. */
  getInstanceDetail(slug: string): Promise<InstanceDetail | undefined>;
  /** A capability, its tools and who it is provided to, by its key. Undefined if there's none. */
  getCapabilityDetail(key: string): Promise<CapabilityDetail | undefined>;
  /** A product, team or service and what it uses, by its slug. Undefined if there's none. */
  getProductTeamServiceDetail(slug: string): Promise<ProductTeamServiceDetail | undefined>;
  /** A business unit, the units around it and what it operates, by key. Undefined if none. */
  getBusinessUnitDetail(key: string): Promise<BusinessUnitDetail | undefined>;
  /** A vendor and its tools, by the vendor's slug. Undefined if there's no such vendor. */
  getVendorDetail(slug: string): Promise<VendorDetail | undefined>;
  /** Every product, team and service, grouped by business unit. */
  getServiceDirectory(): Promise<ServiceDirectory>;
}

const currentLevel = alias(ownershipLevels, "current_ownership_level");
const targetLevel = alias(ownershipLevels, "target_ownership_level");

const teamSummaryFields = {
  id: productTeamServices.id,
  key: productTeamServices.key,
  slug: productTeamServices.slug,
  name: productTeamServices.name,
};

const teamListFields = { ...teamSummaryFields, purpose: productTeamServices.purpose };

const toolSummaryFields = { id: tools.id, key: tools.key, slug: tools.slug, name: tools.name };

const toolListFields = { ...toolSummaryFields, description: tools.description };

const instanceSummaryFields = {
  id: instances.id,
  key: instances.key,
  slug: instances.slug,
  name: instances.name,
  isPlaceholder: instances.isPlaceholder,
  notInUse: instances.notInUse,
};

const businessUnitSummaryFields = {
  id: businessUnits.id,
  key: businessUnits.key,
  name: businessUnits.name,
};

/** Orders by weight (records with no weight last), then name, then id. */
function byWeightThenName(table: {
  readonly weight: PgColumn;
  readonly name: PgColumn;
  readonly id: PgColumn;
}): SQL[] {
  return [sql`${table.weight} ASC NULLS LAST`, asc(table.name), asc(table.id)];
}

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
    .select(toolSummaryFields)
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

async function loadCapabilityDetail(
  reader: Executor,
  key: string,
): Promise<CapabilityDetail | undefined> {
  const [capability] = await reader.select().from(capabilities).where(eq(capabilities.key, key));
  if (capability === undefined) return undefined;

  const providingTools: ToolListEntry[] = await reader
    .select(toolListFields)
    .from(capabilityTools)
    .innerJoin(tools, eq(capabilityTools.toolId, tools.id))
    .where(eq(capabilityTools.capabilityId, capability.id))
    .orderBy(sql`${capabilityTools.position} ASC NULLS LAST`, asc(tools.name), asc(tools.id));

  const provisionRows = await reader
    .select({
      instance: instanceSummaryFields,
      tool: toolSummaryFields,
      productTeamService: teamSummaryFields,
    })
    .from(instanceCapabilities)
    .innerJoin(instances, eq(instanceCapabilities.instanceId, instances.id))
    .innerJoin(tools, eq(instances.toolId, tools.id))
    .innerJoin(
      productTeamServices,
      eq(instanceCapabilities.productTeamServiceId, productTeamServices.id),
    )
    .where(eq(instanceCapabilities.capabilityId, capability.id))
    .orderBy(asc(productTeamServices.name), asc(instances.name), asc(instanceCapabilities.id));

  return {
    capability,
    tools: providingTools,
    provisions: provisionRows.map((row) => ({
      instance: { ...row.instance, tool: row.tool },
      productTeamService: row.productTeamService,
    })),
  };
}

async function loadProductTeamServiceDetail(
  reader: Executor,
  slug: string,
): Promise<ProductTeamServiceDetail | undefined> {
  const [productTeamService] = await reader
    .select()
    .from(productTeamServices)
    .where(eq(productTeamServices.slug, slug));
  if (productTeamService === undefined) return undefined;

  const units: BusinessUnitSummary[] = await reader
    .select(businessUnitSummaryFields)
    .from(businessUnitProductTeamServices)
    .innerJoin(businessUnits, eq(businessUnitProductTeamServices.businessUnitId, businessUnits.id))
    .where(eq(businessUnitProductTeamServices.productTeamServiceId, productTeamService.id))
    .orderBy(...byWeightThenName(businessUnits));

  const usedRows = await reader
    .select({ instance: instanceSummaryFields, tool: toolSummaryFields })
    .from(productTeamServiceInstances)
    .innerJoin(instances, eq(productTeamServiceInstances.instanceId, instances.id))
    .innerJoin(tools, eq(instances.toolId, tools.id))
    .where(eq(productTeamServiceInstances.productTeamServiceId, productTeamService.id))
    .orderBy(asc(tools.name), asc(instances.name), asc(instances.id));
  const used: InstanceOfTool[] = usedRows.map((row) => ({ ...row.instance, tool: row.tool }));

  const providedRows = await reader
    .select({
      capability: capabilitySummaryFields,
      instance: instanceSummaryFields,
      tool: toolSummaryFields,
    })
    .from(instanceCapabilities)
    .innerJoin(capabilities, eq(instanceCapabilities.capabilityId, capabilities.id))
    .innerJoin(instances, eq(instanceCapabilities.instanceId, instances.id))
    .innerJoin(tools, eq(instances.toolId, tools.id))
    .where(eq(instanceCapabilities.productTeamServiceId, productTeamService.id))
    .orderBy(asc(capabilities.name), asc(instances.name), asc(instanceCapabilities.id));

  return {
    productTeamService,
    businessUnits: units,
    instances: used,
    capabilities: providedRows.map((row) => ({
      capability: row.capability,
      instance: { ...row.instance, tool: row.tool },
    })),
  };
}

async function loadBusinessUnitDetail(
  reader: Executor,
  key: string,
): Promise<BusinessUnitDetail | undefined> {
  const [businessUnit] = await reader
    .select()
    .from(businessUnits)
    .where(eq(businessUnits.key, key));
  if (businessUnit === undefined) return undefined;

  let parent: BusinessUnitSummary | null = null;
  if (businessUnit.parentId !== null) {
    const [row] = await reader
      .select(businessUnitSummaryFields)
      .from(businessUnits)
      .where(eq(businessUnits.id, businessUnit.parentId));
    parent = row ?? null;
  }

  const children: BusinessUnitSummary[] = await reader
    .select(businessUnitSummaryFields)
    .from(businessUnits)
    .where(eq(businessUnits.parentId, businessUnit.id))
    .orderBy(...byWeightThenName(businessUnits));

  const operated: ProductTeamServiceListEntry[] = await reader
    .select(teamListFields)
    .from(businessUnitProductTeamServices)
    .innerJoin(
      productTeamServices,
      eq(businessUnitProductTeamServices.productTeamServiceId, productTeamServices.id),
    )
    .where(eq(businessUnitProductTeamServices.businessUnitId, businessUnit.id))
    .orderBy(...byWeightThenName(productTeamServices));

  return { businessUnit, parent, children, productTeamServices: operated };
}

async function loadVendorDetail(reader: Executor, slug: string): Promise<VendorDetail | undefined> {
  const [vendor] = await reader.select().from(vendors).where(eq(vendors.slug, slug));
  if (vendor === undefined) return undefined;

  const vendorTools: ToolListEntry[] = await reader
    .select(toolListFields)
    .from(tools)
    .where(eq(tools.vendorId, vendor.id))
    .orderBy(asc(tools.name), asc(tools.id));

  return { vendor, tools: vendorTools };
}

async function loadServiceDirectory(reader: Executor): Promise<ServiceDirectory> {
  const units: BusinessUnitSummary[] = await reader
    .select(businessUnitSummaryFields)
    .from(businessUnits)
    .orderBy(...byWeightThenName(businessUnits));
  const teams: ProductTeamServiceListEntry[] = await reader
    .select(teamListFields)
    .from(productTeamServices)
    .orderBy(...byWeightThenName(productTeamServices));
  const links = await reader
    .select({
      businessUnitId: businessUnitProductTeamServices.businessUnitId,
      productTeamServiceId: businessUnitProductTeamServices.productTeamServiceId,
    })
    .from(businessUnitProductTeamServices);

  const teamIdsByUnit = new Map<number, Set<number>>();
  const assigned = new Set<number>();
  for (const { businessUnitId, productTeamServiceId } of links) {
    const ids = teamIdsByUnit.get(businessUnitId) ?? new Set<number>();
    ids.add(productTeamServiceId);
    teamIdsByUnit.set(businessUnitId, ids);
    assigned.add(productTeamServiceId);
  }

  // Filtering the ordered list of teams keeps each unit's teams in weight order.
  const withTeams: BusinessUnitWithTeams[] = units.map((unit) => {
    const ids = teamIdsByUnit.get(unit.id);
    return {
      ...unit,
      productTeamServices: ids === undefined ? [] : teams.filter((team) => ids.has(team.id)),
    };
  });
  return {
    businessUnits: withTeams,
    unassigned: teams.filter((team) => !assigned.has(team.id)),
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
    getCapabilityDetail: (key) => load("capability", (reader) => loadCapabilityDetail(reader, key)),
    getProductTeamServiceDetail: (slug) =>
      load("product_team_service", (reader) => loadProductTeamServiceDetail(reader, slug)),
    getBusinessUnitDetail: (key) =>
      load("business_unit", (reader) => loadBusinessUnitDetail(reader, key)),
    getVendorDetail: (slug) => load("vendor", (reader) => loadVendorDetail(reader, slug)),
    getServiceDirectory: () => load("product_team_service", loadServiceDirectory),
  };
}
