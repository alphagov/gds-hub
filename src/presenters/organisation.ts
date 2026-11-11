import type {
  BusinessUnitDetail,
  ProductTeamServiceDetail,
  ProductTeamServiceListEntry,
  ServiceDirectory,
} from "../repositories/index.js";
import { CATALOGUE_PATHS, SECTIONS } from "../site-map.js";
import type {
  BusinessUnitViewModel,
  LinkItem,
  ProductTeamServiceViewModel,
  ServiceGroupViewModel,
  ServicesViewModel,
} from "../view-models.js";
import { instanceLink } from "./capabilities.js";
import { contentsNavigation, type NavigationGroups } from "./contents.js";
import {
  capitalise,
  emailLink,
  formatDate,
  HOME_BREADCRUMB,
  linkItem,
  paragraphs,
  safeHref,
  sectionBreadcrumb,
  textRows,
  websiteLink,
} from "./format.js";

/** The heading for products, teams and services that aren't in a business unit. */
export const NOT_IN_A_BUSINESS_UNIT = "Not in a business unit";

const GITHUB = "https://github.com/";

/** A link to a product, team or service, described by its purpose. */
function teamWithPurpose(team: ProductTeamServiceListEntry): LinkItem {
  return linkItem(
    team.name,
    CATALOGUE_PATHS.productTeamService(team.slug),
    capitalise(team.purpose),
  );
}

/** A link to a Slack channel, shown by its name ("#build-tools") if it has one. */
function slackChannelLink(url: string | null, name: string | null): LinkItem | null {
  const href = safeHref(url);
  const channel = name?.trim().replace(/^#/, "") ?? "";
  if (href === undefined) return null;
  return { text: channel === "" ? href : `#${channel}`, href };
}

export function presentServices(
  directory: ServiceDirectory,
  groups: NavigationGroups,
): ServicesViewModel {
  const { name, description } = SECTIONS.services;
  const unitGroups: ServiceGroupViewModel[] = directory.businessUnits
    .filter((unit) => unit.productTeamServices.length > 0)
    .map((unit) => ({
      heading: unit.name,
      href: CATALOGUE_PATHS.businessUnit(unit.key),
      items: unit.productTeamServices.map(teamWithPurpose),
    }));
  const unassigned: ServiceGroupViewModel[] =
    directory.unassigned.length === 0
      ? []
      : [
          {
            heading: NOT_IN_A_BUSINESS_UNIT,
            href: null,
            items: directory.unassigned.map(teamWithPurpose),
          },
        ];
  return {
    title: name,
    description,
    section: "services",
    breadcrumbs: [HOME_BREADCRUMB],
    contents: contentsNavigation(groups),
    groups: [...unitGroups, ...unassigned],
  };
}

export function presentProductTeamService(
  detail: ProductTeamServiceDetail,
  groups: NavigationGroups,
): ProductTeamServiceViewModel {
  const { productTeamService: team } = detail;
  const email = emailLink(team.teamEmailAddress);
  return {
    title: team.name,
    caption: null,
    section: "services",
    breadcrumbs: [HOME_BREADCRUMB, sectionBreadcrumb("services")],
    contents: contentsNavigation(groups),
    purpose: capitalise(team.purpose),
    businessUnits: detail.businessUnits.map((unit) =>
      linkItem(unit.name, CATALOGUE_PATHS.businessUnit(unit.key)),
    ),
    website: websiteLink(team.url),
    slackChannel: slackChannelLink(team.slackChannel, team.slackChannelName),
    email,
    githubOrganisations: team.ghOrgs.map((organisation) =>
      linkItem(organisation, `${GITHUB}${encodeURIComponent(organisation)}`),
    ),
    rows: textRows([
      // Shown as text if it isn't a plain email address, so it can't become a broken link.
      ["Email", email === null ? team.teamEmailAddress : null],
      ["Escalation contact", team.escalationContact],
      ["Last reviewed", formatDate(team.lastReviewedAt)],
    ]),
    instances: detail.instances.map((instance) =>
      instanceLink(instance, instance.isPlaceholder ? null : instance.tool.name),
    ),
    capabilities: detail.capabilities.map((provided) => ({
      capability: linkItem(
        provided.capability.name,
        CATALOGUE_PATHS.capability(provided.capability.key),
      ),
      instance: instanceLink(provided.instance),
    })),
  };
}

export function presentBusinessUnit(
  detail: BusinessUnitDetail,
  groups: NavigationGroups,
): BusinessUnitViewModel {
  const { businessUnit: unit, parent } = detail;
  const parentLink =
    parent === null ? null : linkItem(parent.name, CATALOGUE_PATHS.businessUnit(parent.key));
  return {
    title: unit.name,
    caption: capitalise(unit.level),
    section: "services",
    breadcrumbs: [
      HOME_BREADCRUMB,
      sectionBreadcrumb("services"),
      ...(parentLink === null ? [] : [parentLink]),
    ],
    contents: contentsNavigation(groups),
    description: paragraphs(unit.description),
    parent: parentLink,
    website: websiteLink(unit.url),
    rows: textRows([
      ["Lead", unit.lead],
      ["Escalation contact", unit.escalationContact],
    ]),
    children: detail.children.map((child) =>
      linkItem(child.name, CATALOGUE_PATHS.businessUnit(child.key)),
    ),
    productTeamServices: detail.productTeamServices.map(teamWithPurpose),
  };
}
