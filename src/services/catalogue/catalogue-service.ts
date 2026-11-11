import type {
  BusinessUnitDetail,
  CapabilityDetail,
  CapabilityRecord,
  InstanceDetail,
  ProductTeamServiceDetail,
  Repositories,
  ServiceDirectory,
  ToolDetail,
  ToolRecord,
  VendorDetail,
} from "../../repositories/index.js";
import { groupCapabilitiesForNavigation, type CapabilityGroup } from "./ordering.js";

/**
 * Read access to the catalogue for the read pages. Lookups return undefined
 * when there's no such record, so the route can show the page not found page.
 */
export interface CatalogueService {
  /** The capabilities shown in navigation, grouped, in weight order. Hidden ones are left out. */
  capabilityGroups(): Promise<CapabilityGroup<CapabilityRecord>[]>;
  capability(key: string): Promise<CapabilityDetail | undefined>;
  /** Every tool, in name order. */
  tools(): Promise<ToolRecord[]>;
  tool(slug: string): Promise<ToolDetail | undefined>;
  instance(slug: string): Promise<InstanceDetail | undefined>;
  serviceDirectory(): Promise<ServiceDirectory>;
  productTeamService(slug: string): Promise<ProductTeamServiceDetail | undefined>;
  businessUnit(key: string): Promise<BusinessUnitDetail | undefined>;
  vendor(slug: string): Promise<VendorDetail | undefined>;
}

/** The repositories the catalogue reads from. */
export type CatalogueRepositories = Pick<Repositories, "capabilities" | "tools" | "catalogue">;

export function createCatalogueService({
  capabilities,
  tools,
  catalogue,
}: CatalogueRepositories): CatalogueService {
  return {
    capabilityGroups: async () => groupCapabilitiesForNavigation(await capabilities.list()),
    capability: (key) => catalogue.getCapabilityDetail(key),
    tools: () => tools.list(),
    tool: (slug) => catalogue.getToolDetail(slug),
    instance: (slug) => catalogue.getInstanceDetail(slug),
    serviceDirectory: () => catalogue.getServiceDirectory(),
    productTeamService: (slug) => catalogue.getProductTeamServiceDetail(slug),
    businessUnit: (key) => catalogue.getBusinessUnitDetail(key),
    vendor: (slug) => catalogue.getVendorDetail(slug),
  };
}
