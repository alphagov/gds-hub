import type {
  ContractDetail,
  InstanceDetail,
  InstanceRecord,
  ProductTeamServiceWithUnits,
  ToolDetail,
  ToolRecord,
  VendorDetail,
} from "../repositories/index.js";
import { CATALOGUE_PATHS, SECTIONS } from "../site-map.js";
import type {
  AccessDetailViewModel,
  ContractViewModel,
  InstanceAccessViewModel,
  InstanceViewModel,
  LinkItem,
  ToolsViewModel,
  ToolViewModel,
  VendorViewModel,
} from "../view-models.js";
import { contentsNavigation, type NavigationGroups } from "./contents.js";
import {
  attributeLabel,
  dateRange,
  formatDate,
  HOME_BREADCRUMB,
  joinNames,
  linkItem,
  migrationStatusTag,
  NOT_IN_USE_TAG,
  paragraphs,
  sectionBreadcrumb,
  textRows,
  toolTypeLabel,
  websiteLink,
  yesNo,
} from "./format.js";

/** The access fields shown as govukDetails, in the order they're shown. */
const ACCESS_FIELDS = [
  ["gettingAccess", "Getting access"],
  ["authentication", "Authentication"],
  ["userProvisioning", "User provisioning"],
  ["escalationContact", "Escalation contact"],
] as const satisfies readonly (readonly [keyof InstanceRecord, string])[];

/** The access details that have been recorded. Empty ones are left out. */
export function accessDetails(instance: InstanceRecord): AccessDetailViewModel[] {
  return ACCESS_FIELDS.map(([field, summary]) => ({
    summary,
    paragraphs: paragraphs(instance[field]),
  })).filter((detail) => detail.paragraphs.length > 0);
}

/**
 * How to get access to an instance. On a tool page each instance's name links
 * to its own page, except a placeholder, which only holds the tool's settings.
 */
export function instanceAccess(
  instance: InstanceRecord,
  { linkToInstance }: { readonly linkToInstance: boolean },
): InstanceAccessViewModel {
  return {
    heading:
      linkToInstance && !instance.isPlaceholder
        ? linkItem(instance.name, CATALOGUE_PATHS.instance(instance.slug))
        : null,
    description: paragraphs(instance.description),
    website: websiteLink(instance.url),
    migrationStatus: migrationStatusTag(instance.migrationStatus),
    notInUse: instance.notInUse ? NOT_IN_USE_TAG : null,
    details: accessDetails(instance),
  };
}

export function presentContract(contract: ContractDetail): ContractViewModel {
  return {
    title: `Contract with ${contract.supplier.name}`,
    rows: textRows([
      ["Dates", dateRange(contract.startDate, contract.endDate)],
      ["Licence type", contract.licenseType],
      ["Licence terms", contract.licenseTerms],
      ["Procurement route", contract.procurementRoute],
      ["Cost", contract.cost],
      ["Cost model", contract.costModel],
      ["Commercials", contract.commercials],
      ["Number of users", contract.totalUsers],
      ["Data protection and security", contract.dataProtectionAndSecurity],
      ["Operational policy", contract.operationalPolicy],
      ["Renewal notes", contract.renewalNotes],
    ]),
  };
}

/** A link to a product, team or service, described by the business units it sits in. */
function teamWithUnits(team: ProductTeamServiceWithUnits): LinkItem {
  return linkItem(
    team.name,
    CATALOGUE_PATHS.productTeamService(team.slug),
    joinNames(team.businessUnits.map((unit) => unit.name)),
  );
}

export function presentTools(
  tools: readonly ToolRecord[],
  groups: NavigationGroups,
): ToolsViewModel {
  const { name, description } = SECTIONS.tools;
  return {
    title: name,
    description,
    section: "tools",
    breadcrumbs: [HOME_BREADCRUMB],
    contents: contentsNavigation(groups),
    items: tools.map((tool) =>
      linkItem(tool.name, CATALOGUE_PATHS.tool(tool.slug), tool.description),
    ),
  };
}

export function presentTool(detail: ToolDetail, groups: NavigationGroups): ToolViewModel {
  const { tool, vendor } = detail;
  return {
    title: tool.name,
    caption: toolTypeLabel(tool.engineeringOrBusinessTool),
    section: "tools",
    breadcrumbs: [HOME_BREADCRUMB, sectionBreadcrumb("tools")],
    contents: contentsNavigation(groups),
    description: paragraphs(tool.description),
    vendor: vendor === null ? null : linkItem(vendor.name, CATALOGUE_PATHS.vendor(vendor.slug)),
    suppliers: joinNames(detail.suppliers.map((supplier) => supplier.name)),
    capabilities: detail.capabilities.map((capability) =>
      linkItem(capability.name, CATALOGUE_PATHS.capability(capability.key)),
    ),
    instances: detail.instances.map((instance) =>
      instanceAccess(instance, { linkToInstance: true }),
    ),
    productTeamServices: detail.productTeamServices.map(teamWithUnits),
    contracts: detail.contracts.map(presentContract),
  };
}

export function presentInstance(
  detail: InstanceDetail,
  groups: NavigationGroups,
): InstanceViewModel {
  const { instance, tool } = detail;
  const toolLink = linkItem(tool.name, CATALOGUE_PATHS.tool(tool.slug));
  return {
    title: instance.name,
    caption: tool.name,
    section: "tools",
    breadcrumbs: [HOME_BREADCRUMB, sectionBreadcrumb("tools"), toolLink],
    contents: contentsNavigation(groups),
    tool: toolLink,
    access: instanceAccess(instance, { linkToInstance: false }),
    rows: textRows([
      ["Migration date", formatDate(instance.migrationDate)],
      [
        "Supported by the GDS software service desk",
        yesNo(instance.supportedByGdsSoftwareServiceDesk),
      ],
      ["Management", instance.management],
      ["Support", instance.support],
      ["Ownership level", detail.ownershipLevel?.name],
      ["Target ownership level", detail.targetOwnershipLevel?.name],
      ["Last reviewed", formatDate(instance.lastReviewedAt)],
    ]),
    // jsonb doesn't keep the order keys were written in, so sort them.
    extraAttributes: textRows(
      Object.entries(instance.extraAttributes)
        .map(([name, value]) => [attributeLabel(name), value] as const)
        .sort(([a], [b]) => a.localeCompare(b, "en-GB")),
    ),
    contract: detail.contract === null ? null : presentContract(detail.contract),
    productTeamServices: detail.productTeamServices.map(teamWithUnits),
    capabilities: detail.capabilities.map((provided) => ({
      capability: linkItem(
        provided.capability.name,
        CATALOGUE_PATHS.capability(provided.capability.key),
      ),
      productTeamService: linkItem(
        provided.productTeamService.name,
        CATALOGUE_PATHS.productTeamService(provided.productTeamService.slug),
      ),
    })),
  };
}

export function presentVendor(detail: VendorDetail, groups: NavigationGroups): VendorViewModel {
  const { vendor } = detail;
  return {
    title: vendor.name,
    caption: "Vendor",
    section: "tools",
    breadcrumbs: [HOME_BREADCRUMB, sectionBreadcrumb("tools")],
    contents: contentsNavigation(groups),
    description: paragraphs(vendor.description),
    website: websiteLink(vendor.url),
    rows: textRows([
      ["Support contact", vendor.supportContact],
      ["Data protection contact", vendor.dataProtectionContact],
    ]),
    tools: detail.tools.map((tool) =>
      linkItem(tool.name, CATALOGUE_PATHS.tool(tool.slug), tool.description),
    ),
  };
}
