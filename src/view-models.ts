/**
 * View models: the only data templates receive (as `page`). Every template is
 * listed in `Views`, so `render` checks at compile time that a template gets
 * the right model. They're built in src/presenters, so templates only loop
 * and test conditions.
 */

import type { SectionKey } from "./site-map.js";

export interface Breadcrumb {
  readonly text: string;
  readonly href: string;
}

export interface LinkItem {
  readonly text: string;
  readonly href: string;
  readonly description?: string;
}

/** One link in the left-hand contents. */
export interface ContentsItem {
  readonly text: string;
  readonly href: string;
  /** The page is this item's page: sets aria-current="page". */
  readonly current: boolean;
}

export interface ContentsGroup {
  readonly name: string;
  readonly items: readonly ContentsItem[];
}

/** The left-hand contents: capability groups and their capabilities. */
export interface ContentsViewModel {
  /** The navigation's accessible name, and the toggle's text on small screens. */
  readonly label: string;
  readonly groups: readonly ContentsGroup[];
}

/** Fields every page has. Read by layouts/base.njk. */
export interface PageViewModel {
  /** The h1 and the first part of the document title. */
  readonly title: string;
  readonly breadcrumbs?: readonly Breadcrumb[];
  /**
   * The service navigation section to mark as active. Only needed when the
   * page's address isn't under the section's own path, such as an instance
   * page, which belongs to Tools.
   */
  readonly section?: SectionKey;
  /** Shown down the left of the page. Error pages have none. */
  readonly contents?: ContentsViewModel;
}

/** Read by layouts/listing.njk. */
export interface ListingViewModel extends PageViewModel {
  readonly items: readonly LinkItem[];
}

/** Read by layouts/catalogue.njk. */
export interface CataloguePageViewModel extends PageViewModel {
  /** Shown above the h1, for example the tool an instance belongs to. */
  readonly caption: string | null;
}

/** The parameters for govukTag. */
export interface TagViewModel {
  readonly text: string;
  readonly classes?: string;
}

/** A plain-text row for govukSummaryList. Rows with links or tags are written in the template. */
export interface SummaryRow {
  readonly key: { readonly text: string };
  readonly value: { readonly text: string };
}

export interface CapabilityGroupViewModel {
  readonly name: string;
  /** Each capability, with its description. */
  readonly capabilities: readonly LinkItem[];
}

export interface HomeViewModel extends PageViewModel {
  readonly groups: readonly CapabilityGroupViewModel[];
}

export interface CapabilitiesViewModel extends PageViewModel {
  readonly description: string;
  readonly groups: readonly CapabilityGroupViewModel[];
}

/** A product, team or service, and the instance it gets a capability through. */
export interface ProvisionViewModel {
  readonly productTeamService: LinkItem;
  readonly instance: LinkItem;
}

export interface CapabilityViewModel extends CataloguePageViewModel {
  readonly description: readonly string[];
  /** Shown under "Plans". */
  readonly plans: readonly string[];
  readonly tools: readonly LinkItem[];
  readonly provisions: readonly ProvisionViewModel[];
}

/** One govukDetails in an instance's access information. */
export interface AccessDetailViewModel {
  readonly summary: string;
  readonly paragraphs: readonly string[];
}

/** How to get access to one instance. Read by partials/instance-access.njk. */
export interface InstanceAccessViewModel {
  /** A link to the instance's own page. Null for a placeholder, or on the instance's own page. */
  readonly heading: LinkItem | null;
  readonly description: readonly string[];
  readonly website: LinkItem | null;
  readonly migrationStatus: TagViewModel;
  readonly notInUse: TagViewModel | null;
  /** Getting access, authentication, user provisioning and escalation contact, if recorded. */
  readonly details: readonly AccessDetailViewModel[];
}

export interface ContractViewModel {
  readonly title: string;
  readonly rows: readonly SummaryRow[];
}

export interface ToolsViewModel extends ListingViewModel {
  readonly description: string;
}

export interface ToolViewModel extends CataloguePageViewModel {
  readonly description: readonly string[];
  readonly vendor: LinkItem | null;
  /** The suppliers' names, or null if there are none. */
  readonly suppliers: string | null;
  readonly capabilities: readonly LinkItem[];
  readonly instances: readonly InstanceAccessViewModel[];
  /** Each with its business units as the description. */
  readonly productTeamServices: readonly LinkItem[];
  readonly contracts: readonly ContractViewModel[];
}

/** A capability an instance provides, and who it is provided to. */
export interface ProvidedCapabilityViewModel {
  readonly capability: LinkItem;
  readonly productTeamService: LinkItem;
}

export interface InstanceViewModel extends CataloguePageViewModel {
  readonly tool: LinkItem;
  readonly access: InstanceAccessViewModel;
  readonly rows: readonly SummaryRow[];
  readonly extraAttributes: readonly SummaryRow[];
  readonly contract: ContractViewModel | null;
  readonly productTeamServices: readonly LinkItem[];
  readonly capabilities: readonly ProvidedCapabilityViewModel[];
}

export interface VendorViewModel extends CataloguePageViewModel {
  readonly description: readonly string[];
  readonly website: LinkItem | null;
  readonly rows: readonly SummaryRow[];
  readonly tools: readonly LinkItem[];
}

/** A business unit (or "not in a business unit") and its products, teams and services. */
export interface ServiceGroupViewModel {
  readonly heading: string;
  /** The business unit's page, or null for the group of those not in a unit. */
  readonly href: string | null;
  readonly items: readonly LinkItem[];
}

export interface ServicesViewModel extends PageViewModel {
  readonly description: string;
  readonly groups: readonly ServiceGroupViewModel[];
}

/** A capability provided to a product, team or service, and the instance that provides it. */
export interface ProvidedThroughViewModel {
  readonly capability: LinkItem;
  readonly instance: LinkItem;
}

export interface ProductTeamServiceViewModel extends CataloguePageViewModel {
  /** What it does, shown as the lead paragraph. */
  readonly purpose: string | null;
  readonly businessUnits: readonly LinkItem[];
  readonly website: LinkItem | null;
  readonly slackChannel: LinkItem | null;
  readonly email: LinkItem | null;
  readonly githubOrganisations: readonly LinkItem[];
  readonly rows: readonly SummaryRow[];
  readonly instances: readonly LinkItem[];
  readonly capabilities: readonly ProvidedThroughViewModel[];
}

export interface BusinessUnitViewModel extends CataloguePageViewModel {
  readonly description: readonly string[];
  readonly parent: LinkItem | null;
  readonly website: LinkItem | null;
  readonly rows: readonly SummaryRow[];
  readonly children: readonly LinkItem[];
  readonly productTeamServices: readonly LinkItem[];
}

export interface SectionViewModel extends ListingViewModel {
  readonly description: string;
}

export interface ErrorViewModel extends PageViewModel {
  /** Shown on the 500 page so users can quote it. */
  readonly requestId?: string;
}

export interface Views {
  "pages/home.njk": HomeViewModel;
  "pages/capabilities.njk": CapabilitiesViewModel;
  "pages/capability.njk": CapabilityViewModel;
  "pages/tools.njk": ToolsViewModel;
  "pages/tool.njk": ToolViewModel;
  "pages/instance.njk": InstanceViewModel;
  "pages/vendor.njk": VendorViewModel;
  "pages/services.njk": ServicesViewModel;
  "pages/product-team-service.njk": ProductTeamServiceViewModel;
  "pages/business-unit.njk": BusinessUnitViewModel;
  "pages/section.njk": SectionViewModel;
  "errors/403.njk": ErrorViewModel;
  "errors/404.njk": ErrorViewModel;
  "errors/500.njk": ErrorViewModel;
}

export type ViewName = keyof Views;
