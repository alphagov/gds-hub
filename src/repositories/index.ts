import { connect } from "../db/client.js";
import {
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
} from "../db/schema/index.js";
import { createAuditLogRepository, type AuditLogRepository } from "./audit-log-repository.js";
import {
  createCatalogueReadRepository,
  type CatalogueReadRepository,
} from "./catalogue-read-repository.js";
import { runInTransaction, type Executor } from "./executor.js";
import { createRepository, type Repository } from "./repository.js";

export type { EntityType } from "../db/entity-types.js";
export type { AuditAction, AuditEntry, AuditLogRepository } from "./audit-log-repository.js";
export type { CatalogueReadRepository } from "./catalogue-read-repository.js";
export {
  RepositoryError,
  type RepositoryErrorKind,
  type RepositoryOperation,
  type RepositorySubject,
} from "./errors.js";
export type { Executor } from "./executor.js";
export type * from "./read-models.js";
export {
  createRepository,
  type AuditedTable,
  type BaseRepository,
  type EntityTypeOfTable,
  type ListOptions,
  type NewRecord,
  type RecordChanges,
  type RecordOf,
  type Repository,
  type RepositoryFactory,
  type SlugLookup,
  type UpdateResult,
  type WriteOptions,
} from "./repository.js";

/** Every repository, bound to the pool or to one transaction. */
export interface Repositories {
  readonly vendors: Repository<typeof vendors>;
  readonly suppliers: Repository<typeof suppliers>;
  readonly tools: Repository<typeof tools>;
  readonly supplierTools: Repository<typeof supplierTools>;
  readonly contracts: Repository<typeof contracts>;
  readonly ownershipLevels: Repository<typeof ownershipLevels>;
  readonly instances: Repository<typeof instances>;
  readonly capabilities: Repository<typeof capabilities>;
  readonly capabilityTools: Repository<typeof capabilityTools>;
  readonly productTeamServices: Repository<typeof productTeamServices>;
  readonly productTeamServiceInstances: Repository<typeof productTeamServiceInstances>;
  readonly instanceCapabilities: Repository<typeof instanceCapabilities>;
  readonly businessUnits: Repository<typeof businessUnits>;
  readonly businessUnitProductTeamServices: Repository<typeof businessUnitProductTeamServices>;
  readonly pages: Repository<typeof pages>;
  /** Reads the audit log. Entries are only added by the writes above. */
  readonly auditLog: AuditLogRepository;
  /** Read models for the catalogue's detail pages. */
  readonly catalogue: CatalogueReadRepository;
  /**
   * Runs `work` with repositories bound to one transaction, so several writes
   * (and their audit entries) are kept or rolled back together. If `work`
   * throws, everything it wrote is rolled back and the error is rethrown.
   */
  transaction<R>(work: (repositories: Repositories) => Promise<R>): Promise<R>;
}

const factories = {
  vendors: createRepository(vendors, "vendor"),
  suppliers: createRepository(suppliers, "supplier"),
  tools: createRepository(tools, "tool"),
  supplierTools: createRepository(supplierTools, "supplier_tool"),
  contracts: createRepository(contracts, "contract"),
  ownershipLevels: createRepository(ownershipLevels, "ownership_level"),
  instances: createRepository(instances, "instance"),
  capabilities: createRepository(capabilities, "capability"),
  capabilityTools: createRepository(capabilityTools, "capability_tool"),
  productTeamServices: createRepository(productTeamServices, "product_team_service"),
  productTeamServiceInstances: createRepository(
    productTeamServiceInstances,
    "product_team_service_instance",
  ),
  instanceCapabilities: createRepository(instanceCapabilities, "instance_capability"),
  businessUnits: createRepository(businessUnits, "business_unit"),
  businessUnitProductTeamServices: createRepository(
    businessUnitProductTeamServices,
    "business_unit_product_team_service",
  ),
  pages: createRepository(pages, "page"),
} as const;

/** The repositories, bound to the pool or to an open transaction. */
export function createRepositories(executor: Executor): Repositories {
  return {
    vendors: factories.vendors(executor),
    suppliers: factories.suppliers(executor),
    tools: factories.tools(executor),
    supplierTools: factories.supplierTools(executor),
    contracts: factories.contracts(executor),
    ownershipLevels: factories.ownershipLevels(executor),
    instances: factories.instances(executor),
    capabilities: factories.capabilities(executor),
    capabilityTools: factories.capabilityTools(executor),
    productTeamServices: factories.productTeamServices(executor),
    productTeamServiceInstances: factories.productTeamServiceInstances(executor),
    instanceCapabilities: factories.instanceCapabilities(executor),
    businessUnits: factories.businessUnits(executor),
    businessUnitProductTeamServices: factories.businessUnitProductTeamServices(executor),
    pages: factories.pages(executor),
    auditLog: createAuditLogRepository(executor),
    catalogue: createCatalogueReadRepository(executor),
    transaction<R>(work: (repositories: Repositories) => Promise<R>): Promise<R> {
      return runInTransaction(executor, (tx) => work(createRepositories(tx)));
    },
  };
}

export interface RepositoryConnection {
  readonly repositories: Repositories;
  /** Closes every connection in the pool. Call once when shutting down. */
  close(): Promise<void>;
}

/** Opens a connection pool and returns the repositories bound to it. */
export function connectRepositories(databaseUrl: string): RepositoryConnection {
  const connection = connect(databaseUrl);
  return {
    repositories: createRepositories(connection.db),
    close: () => connection.close(),
  };
}
