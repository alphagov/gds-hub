import type { contracts, instances, suppliers, tools, vendors } from "../db/schema/index.js";

// Typed read models for the catalogue's detail pages: a record with the
// records linked to it, loaded together from one snapshot of the database.

export type ToolRecord = typeof tools.$inferSelect;
export type VendorRecord = typeof vendors.$inferSelect;
export type SupplierRecord = typeof suppliers.$inferSelect;
export type ContractRecord = typeof contracts.$inferSelect;
export type InstanceRecord = typeof instances.$inferSelect;

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

/** A contract with the supplier it is with. */
export type ContractDetail = ContractRecord & { readonly supplier: SupplierSummary };

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
