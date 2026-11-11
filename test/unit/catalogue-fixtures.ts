// Invented records for unit tests of the presenters, routes and templates.
// Every name, address and value here is synthetic.

import type {
  BusinessUnitDetail,
  CapabilityDetail,
  CapabilityRecord,
  InstanceDetail,
  InstanceRecord,
  ProductTeamServiceDetail,
  ServiceDirectory,
  ToolDetail,
  ToolRecord,
  VendorDetail,
} from "../../src/repositories/index.js";
import type { CatalogueService } from "../../src/services/catalogue/catalogue-service.js";
import {
  groupCapabilitiesForNavigation,
  type CapabilityGroup,
} from "../../src/services/catalogue/ordering.js";

const CREATED = new Date("2026-01-01T09:00:00Z");

export function capabilityRecord(overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  return {
    id: 1,
    key: "map-making",
    name: "Map making",
    description: "Draw maps of invented places.",
    groupName: "Cartography",
    comment: null,
    weight: null,
    hideInNavigation: false,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

export function toolRecord(overrides: Partial<ToolRecord> = {}): ToolRecord {
  return {
    id: 1,
    key: "atlas-maker",
    slug: "atlas-maker",
    name: "Atlas Maker",
    description: "Makes atlases.",
    engineeringOrBusinessTool: "engineering",
    vendorId: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

export function instanceRecord(overrides: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    id: 1,
    key: "atlas-maker-main",
    slug: "atlas-maker-main",
    name: "Atlas Maker main workspace",
    toolId: 1,
    contractId: null,
    url: "https://atlas.example.com",
    description: "The shared workspace.",
    gettingAccess: "Ask in the #atlas channel.",
    management: null,
    authentication: "Sign in with an invented provider.",
    userProvisioning: null,
    support: null,
    escalationContact: null,
    supportedByGdsSoftwareServiceDesk: false,
    notInUse: false,
    isPlaceholder: false,
    migrationStatus: "not_started",
    migrationDate: null,
    ownershipLevelId: null,
    targetOwnershipLevelId: null,
    extraAttributes: {},
    lastReviewedAt: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

export const capabilities: CapabilityRecord[] = [
  capabilityRecord(),
  capabilityRecord({ id: 2, key: "globe-spinning", name: "Globe spinning", weight: 1 }),
  capabilityRecord({
    id: 3,
    key: "secret-passages",
    name: "Secret passages",
    hideInNavigation: true,
  }),
];

export const groups: CapabilityGroup<CapabilityRecord>[] =
  groupCapabilitiesForNavigation(capabilities);

export function toolDetail(overrides: Partial<ToolDetail> = {}): ToolDetail {
  return {
    tool: toolRecord(),
    vendor: null,
    suppliers: [],
    contracts: [],
    capabilities: [{ id: 1, key: "map-making", name: "Map making", groupName: "Cartography" }],
    instances: [{ ...instanceRecord(), ownershipLevel: null, targetOwnershipLevel: null }],
    productTeamServices: [],
    ...overrides,
  };
}

export function instanceDetail(overrides: Partial<InstanceDetail> = {}): InstanceDetail {
  return {
    instance: instanceRecord(),
    tool: { id: 1, key: "atlas-maker", slug: "atlas-maker", name: "Atlas Maker" },
    contract: null,
    ownershipLevel: null,
    targetOwnershipLevel: null,
    productTeamServices: [],
    capabilities: [],
    ...overrides,
  };
}

export function capabilityDetail(overrides: Partial<CapabilityDetail> = {}): CapabilityDetail {
  return {
    capability: capabilityRecord(),
    tools: [
      {
        id: 1,
        key: "atlas-maker",
        slug: "atlas-maker",
        name: "Atlas Maker",
        description: "Makes atlases.",
      },
    ],
    provisions: [],
    ...overrides,
  };
}

export function productTeamServiceDetail(
  overrides: Partial<ProductTeamServiceDetail> = {},
): ProductTeamServiceDetail {
  return {
    productTeamService: {
      id: 1,
      key: "mapping-team",
      slug: "mapping-team",
      name: "Mapping Team",
      purpose: "draws maps of invented places",
      url: null,
      slackChannel: "https://example.slack.com/archives/C0000000009",
      slackChannelName: "mapping",
      teamEmailAddress: "mapping@example.com",
      ghOrgs: ["example-maps"],
      escalationContact: null,
      lastReviewedAt: "2026-10-01",
      weight: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    businessUnits: [{ id: 1, key: "exploration", name: "Exploration" }],
    instances: [],
    capabilities: [],
    ...overrides,
  };
}

export function businessUnitDetail(
  overrides: Partial<BusinessUnitDetail> = {},
): BusinessUnitDetail {
  return {
    businessUnit: {
      id: 2,
      key: "exploration",
      name: "Exploration",
      level: "directorate",
      description: "Explores invented places.",
      lead: "Pat Example",
      url: null,
      escalationContact: null,
      parentId: null,
      weight: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    parent: null,
    children: [],
    productTeamServices: [],
    ...overrides,
  };
}

export function vendorDetail(overrides: Partial<VendorDetail> = {}): VendorDetail {
  return {
    vendor: {
      id: 1,
      slug: "compass-co",
      name: "Compass Co",
      description: "Makes invented mapping software.",
      url: "https://compass.example.com",
      supportContact: "help@compass.example.com",
      dataProtectionContact: null,
      createdAt: CREATED,
      updatedAt: CREATED,
    },
    tools: [],
    ...overrides,
  };
}

export const serviceDirectory: ServiceDirectory = {
  businessUnits: [
    {
      id: 2,
      key: "exploration",
      name: "Exploration",
      productTeamServices: [
        {
          id: 1,
          key: "mapping-team",
          slug: "mapping-team",
          name: "Mapping Team",
          purpose: "draws maps",
        },
      ],
    },
  ],
  unassigned: [],
};

/**
 * A catalogue service with one of everything. Pass overrides to change what a
 * method returns, for example `{ tool: () => Promise.resolve(undefined) }`.
 */
export function fakeCatalogue(overrides: Partial<CatalogueService> = {}): CatalogueService {
  return {
    capabilityGroups: () => Promise.resolve(groups),
    capability: (key) => Promise.resolve(key === "map-making" ? capabilityDetail() : undefined),
    tools: () => Promise.resolve([toolRecord()]),
    tool: (slug) => Promise.resolve(slug === "atlas-maker" ? toolDetail() : undefined),
    instance: (slug) => Promise.resolve(slug === "atlas-maker-main" ? instanceDetail() : undefined),
    serviceDirectory: () => Promise.resolve(serviceDirectory),
    productTeamService: (slug) =>
      Promise.resolve(slug === "mapping-team" ? productTeamServiceDetail() : undefined),
    businessUnit: (key) =>
      Promise.resolve(key === "exploration" ? businessUnitDetail() : undefined),
    vendor: (slug) => Promise.resolve(slug === "compass-co" ? vendorDetail() : undefined),
    ...overrides,
  };
}
