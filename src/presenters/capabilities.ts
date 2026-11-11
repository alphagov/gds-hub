import type { CapabilityDetail, InstanceOfTool } from "../repositories/index.js";
import { CATALOGUE_PATHS, SECTIONS, SERVICE_NAME } from "../site-map.js";
import type {
  CapabilitiesViewModel,
  CapabilityViewModel,
  HomeViewModel,
  LinkItem,
} from "../view-models.js";
import { capabilityGroupList, contentsNavigation, type NavigationGroups } from "./contents.js";
import { HOME_BREADCRUMB, linkItem, nonBlank, paragraphs, sectionBreadcrumb } from "./format.js";

/**
 * A link to an instance's page. A placeholder instance only stands in for its
 * tool's own settings, so it links to the tool instead.
 */
export function instanceLink(instance: InstanceOfTool, description?: string | null): LinkItem {
  return instance.isPlaceholder
    ? linkItem(instance.tool.name, CATALOGUE_PATHS.tool(instance.tool.slug), description)
    : linkItem(instance.name, CATALOGUE_PATHS.instance(instance.slug), description);
}

export function presentHome(groups: NavigationGroups): HomeViewModel {
  return {
    title: SERVICE_NAME,
    contents: contentsNavigation(groups),
    groups: capabilityGroupList(groups),
  };
}

export function presentCapabilities(groups: NavigationGroups): CapabilitiesViewModel {
  const { name, description } = SECTIONS.capabilities;
  return {
    title: name,
    description,
    section: "capabilities",
    breadcrumbs: [HOME_BREADCRUMB],
    contents: contentsNavigation(groups),
    groups: capabilityGroupList(groups),
  };
}

export function presentCapability(
  detail: CapabilityDetail,
  groups: NavigationGroups,
): CapabilityViewModel {
  const { capability } = detail;
  return {
    title: capability.name,
    caption: nonBlank(capability.groupName),
    section: "capabilities",
    breadcrumbs: [HOME_BREADCRUMB, sectionBreadcrumb("capabilities")],
    contents: contentsNavigation(groups, capability.key),
    description: paragraphs(capability.description),
    plans: paragraphs(capability.comment),
    tools: detail.tools.map((tool) =>
      linkItem(tool.name, CATALOGUE_PATHS.tool(tool.slug), tool.description),
    ),
    provisions: detail.provisions.map((provision) => ({
      productTeamService: linkItem(
        provision.productTeamService.name,
        CATALOGUE_PATHS.productTeamService(provision.productTeamService.slug),
      ),
      instance: instanceLink(provision.instance),
    })),
  };
}
