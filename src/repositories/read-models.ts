import type {
  businessUnits,
  capabilities,
  contracts,
  instances,
  productTeamServices,
  suppliers,
  tools,
  vendors,
} from "../db/schema/index.js";

// Typed read models for the catalogue's detail pages: a record with the
// records linked to it, loaded together from one snapshot of the database.

export type ToolRecord = typeof tools.$inferSelect;
export type VendorRecord = typeof vendors.$inferSelect;
export type SupplierRecord = typeof suppliers.$inferSelect;
export type ContractRecord = typeof contracts.$inferSelect;
export type InstanceRecord = typeof instances.$inferSelect;
export type CapabilityRecord = typeof capabilities.$inferSelect;
export type ProductTeamServiceRecord = typeof productTeamServices.$inferSelect;
export type BusinessUnitRecord = typeof businessUnits.$inferSelect;

export interface ToolSummary {
  readonly id: number;
  readonly key: string;
  readonly slug: string;
  readonly name: string;
}

export interface SupplierSummary {
  readonly id: number;
  readonly name: string;
  readonly url: string | null;
}

export interface OwnershipLevelSummary {
  readonly id: number;
  readonly key: string;
  readonly name: string;
}

export interface CapabilitySummary {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly groupName: string | null;
}

export interface BusinessUnitSummary {
  readonly id: number;
  readonly key: string;
  readonly name: string;
}

export interface ProductTeamServiceSummary {
  readonly id: number;
  readonly key: string;
  readonly slug: string;
  readonly name: string;
}

/** A product, team or service, with the business units it sits in (in name order). */
export interface ProductTeamServiceWithUnits extends ProductTeamServiceSummary {
  readonly businessUnits: readonly BusinessUnitSummary[];
}

/** A contract with the supplier it is with, if one is recorded. */
export type ContractDetail = ContractRecord & { readonly supplier: SupplierSummary | null };

/** An instance with its current and target ownership levels. */
export type InstanceWithOwnership = InstanceRecord & {
  readonly ownershipLevel: OwnershipLevelSummary | null;
  readonly targetOwnershipLevel: OwnershipLevelSummary | null;
};

export interface ToolDetail {
  readonly tool: ToolRecord;
  readonly vendor: VendorRecord | null;
  /** In name order. */
  readonly suppliers: readonly SupplierRecord[];
  /** Newest start date first; contracts with no start date last. */
  readonly contracts: readonly ContractDetail[];
  /** In their set position, then name order. */
  readonly capabilities: readonly CapabilitySummary[];
  /**
   * Every instance of the tool, in name order, including any placeholder
   * (`isPlaceholder`) that holds the tool's own settings.
   */
  readonly instances: readonly InstanceWithOwnership[];
  /** Each product, team or service using any of the tool's instances, once, in name order. */
  readonly productTeamServices: readonly ProductTeamServiceWithUnits[];
}

/** A capability an instance provides, and who it is provided to. */
export interface ProvidedCapability {
  readonly capability: CapabilitySummary;
  readonly productTeamService: ProductTeamServiceSummary;
}

export interface InstanceDetail {
  readonly instance: InstanceRecord;
  readonly tool: ToolSummary;
  readonly contract: ContractDetail | null;
  readonly ownershipLevel: OwnershipLevelSummary | null;
  readonly targetOwnershipLevel: OwnershipLevelSummary | null;
  /** The products, teams and services that use the instance, in name order. */
  readonly productTeamServices: readonly ProductTeamServiceWithUnits[];
  /** In capability name order, then by product, team or service name. */
  readonly capabilities: readonly ProvidedCapability[];
}

/** A tool with its description, for lists of tools. */
export interface ToolListEntry extends ToolSummary {
  readonly description: string | null;
}

export interface InstanceSummary {
  readonly id: number;
  readonly key: string;
  readonly slug: string;
  readonly name: string;
  /** Stands in for the tool's own settings, so pages link to the tool instead. */
  readonly isPlaceholder: boolean;
  readonly notInUse: boolean;
}

/** An instance with the tool it is an instance of. */
export interface InstanceOfTool extends InstanceSummary {
  readonly tool: ToolSummary;
}

/** A product, team or service with its purpose, for lists of them. */
export interface ProductTeamServiceListEntry extends ProductTeamServiceSummary {
  readonly purpose: string | null;
}

/** Which instance provides a capability to which product, team or service. */
export interface CapabilityProvision {
  readonly instance: InstanceOfTool;
  readonly productTeamService: ProductTeamServiceSummary;
}

export interface CapabilityDetail {
  readonly capability: CapabilityRecord;
  /** The tools that provide the capability, in their set position, then name order. */
  readonly tools: readonly ToolListEntry[];
  /** By product, team or service name, then instance name. */
  readonly provisions: readonly CapabilityProvision[];
}

/** A capability provided to a product, team or service, and the instance that provides it. */
export interface ProvidedThrough {
  readonly capability: CapabilitySummary;
  readonly instance: InstanceOfTool;
}

export interface ProductTeamServiceDetail {
  readonly productTeamService: ProductTeamServiceRecord;
  /** By weight (no weight last), then name. */
  readonly businessUnits: readonly BusinessUnitSummary[];
  /** The instances it uses, by tool name, then instance name. */
  readonly instances: readonly InstanceOfTool[];
  /** The capabilities provided to it, by capability name, then instance name. */
  readonly capabilities: readonly ProvidedThrough[];
}

export interface BusinessUnitDetail {
  readonly businessUnit: BusinessUnitRecord;
  /** The unit it sits inside, or null for a top-level unit. */
  readonly parent: BusinessUnitSummary | null;
  /** The units directly inside it, by weight (no weight last), then name. */
  readonly children: readonly BusinessUnitSummary[];
  /** The products, teams and services it operates, by weight (no weight last), then name. */
  readonly productTeamServices: readonly ProductTeamServiceListEntry[];
}

export interface VendorDetail {
  readonly vendor: VendorRecord;
  /** The vendor's tools, in name order. */
  readonly tools: readonly ToolListEntry[];
}

/** A business unit with the products, teams and services it operates. */
export interface BusinessUnitWithTeams extends BusinessUnitSummary {
  /** By weight (no weight last), then name. */
  readonly productTeamServices: readonly ProductTeamServiceListEntry[];
}

/** Every product, team and service, grouped by business unit. */
export interface ServiceDirectory {
  /**
   * Every business unit, by weight (no weight last), then name. A product,
   * team or service in more than one unit is listed under each of them.
   */
  readonly businessUnits: readonly BusinessUnitWithTeams[];
  /** Products, teams and services that aren't in any business unit, by weight, then name. */
  readonly unassigned: readonly ProductTeamServiceListEntry[];
}
