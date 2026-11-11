import type { CapabilityGroup } from "../services/catalogue/ordering.js";
import { CATALOGUE_PATHS, CONTENTS_LABEL } from "../site-map.js";
import type { CapabilityGroupViewModel, ContentsViewModel } from "../view-models.js";
import { linkItem } from "./format.js";

/** The heading for capabilities that have no group. */
export const UNGROUPED_CAPABILITIES = "Other capabilities";

/** A capability as the contents and capability lists need it. */
export interface ListedCapability {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly groupName: string | null;
  readonly weight: number | null;
  readonly hideInNavigation: boolean;
}

/** The capability groups from the catalogue service, which every page's contents is built from. */
export type NavigationGroups = readonly CapabilityGroup<ListedCapability>[];

/**
 * The left-hand contents shown on every page: each capability group and its
 * capabilities, in the order the catalogue service gives them. Pass the key
 * of the capability whose page this is, so it is marked as the current page.
 */
export function contentsNavigation(
  groups: NavigationGroups,
  currentCapabilityKey?: string,
): ContentsViewModel {
  return {
    label: CONTENTS_LABEL,
    groups: groups.map((group) => ({
      name: group.name ?? UNGROUPED_CAPABILITIES,
      items: group.capabilities.map((capability) => ({
        text: capability.name,
        href: CATALOGUE_PATHS.capability(capability.key),
        current: capability.key === currentCapabilityKey,
      })),
    })),
  };
}

/** The capability groups for the home and capabilities pages, with descriptions. */
export function capabilityGroupList(groups: NavigationGroups): CapabilityGroupViewModel[] {
  return groups.map((group) => ({
    name: group.name ?? UNGROUPED_CAPABILITIES,
    capabilities: group.capabilities.map((capability) =>
      linkItem(capability.name, CATALOGUE_PATHS.capability(capability.key), capability.description),
    ),
  }));
}
