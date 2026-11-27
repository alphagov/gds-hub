import type { EditEntityKey, EditValues } from "../../editing/entities.js";
import type { NavigationGroups } from "../../presenters/contents.js";
import type { RepositorySubject } from "../../repositories/errors.js";
import { RepositoryError } from "../../repositories/errors.js";
import type {
  InstanceDetail,
  InstanceRecord,
  PageDetail,
  PageRecord,
  ProductTeamServiceDetail,
  ProductTeamServiceRecord,
  ToolDetail,
  ToolRecord,
  VendorDetail,
  VendorRecord,
} from "../../repositories/index.js";
import { READER_PAGE_TYPES } from "../../validation/catalogue.js";
import type { CatalogueService } from "../catalogue/catalogue-service.js";
import type { ContentSection, ContentService } from "../content/content-service.js";
import type { EditService } from "./edit-service.js";

// What a preview shows: the record as the editor typed it, in place of the
// saved one, with everything else on the page as it is saved. Nothing here
// writes: it only reads, through the same services as the read pages.

/** The page a preview shows, as the same details the read page is built from. */
export type PreviewData =
  | { readonly kind: "vendors"; readonly detail: VendorDetail; readonly groups: NavigationGroups }
  | { readonly kind: "tools"; readonly detail: ToolDetail; readonly groups: NavigationGroups }
  | {
      readonly kind: "instances";
      readonly detail: InstanceDetail;
      readonly groups: NavigationGroups;
    }
  | {
      readonly kind: "services";
      readonly detail: ProductTeamServiceDetail;
      readonly guides: readonly PageRecord[];
      readonly groups: NavigationGroups;
    }
  | {
      readonly kind: "pages";
      readonly section: ContentSection;
      /** The page's type has no section on the read pages yet, so it is shown in the nearest one. */
      readonly notShownToReaders: boolean;
      readonly detail: PageDetail;
      readonly groups: NavigationGroups;
    };

export interface PreviewService {
  /**
   * The details for a preview of `values` as the record `id` (or as a new
   * record when there is no id). Throws RepositoryError("not_found") if the
   * record doesn't exist, and RepositoryError("invalid_reference") if a choice
   * in the form names a record that is gone or can't go with the rest.
   */
  build(key: EditEntityKey, id: number | undefined, values: EditValues): Promise<PreviewData>;
}

const NOW = (): Date => new Date();

const ENTITY_TYPE: Readonly<Record<EditEntityKey, RepositorySubject>> = {
  pages: "page",
  tools: "tool",
  instances: "instance",
  vendors: "vendor",
  services: "product_team_service",
};

function blankVendor(): VendorRecord {
  return {
    id: 0,
    slug: "",
    name: "",
    description: null,
    url: null,
    supportContact: null,
    dataProtectionContact: null,
    createdAt: NOW(),
    updatedAt: NOW(),
  };
}

function blankTool(): ToolRecord {
  return {
    id: 0,
    key: "",
    slug: "",
    name: "",
    description: null,
    engineeringOrBusinessTool: "engineering",
    vendorId: null,
    createdAt: NOW(),
    updatedAt: NOW(),
  };
}

function blankInstance(): InstanceRecord {
  return {
    id: 0,
    key: "",
    slug: "",
    name: "",
    toolId: 0,
    contractId: null,
    url: null,
    description: null,
    gettingAccess: null,
    management: null,
    authentication: null,
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
    createdAt: NOW(),
    updatedAt: NOW(),
  };
}

function blankTeam(): ProductTeamServiceRecord {
  return {
    id: 0,
    key: "",
    slug: "",
    name: "",
    purpose: null,
    url: null,
    slackChannel: null,
    slackChannelName: null,
    teamEmailAddress: null,
    ghOrgs: [],
    escalationContact: null,
    lastReviewedAt: null,
    weight: null,
    createdAt: NOW(),
    updatedAt: NOW(),
  };
}

function blankPage(): PageRecord {
  return {
    id: 0,
    slug: "",
    title: "",
    pageType: "general",
    summary: null,
    bodyMarkdown: "",
    ownerName: null,
    ownerContact: null,
    productTeamServiceId: null,
    status: "draft",
    lastReviewedAt: null,
    publishedAt: null,
    createdAt: NOW(),
    updatedAt: NOW(),
  };
}

/**
 * The record with the typed values in place of its own. Only fields the
 * record already has are taken, so an unexpected value can't add one. The
 * values have been through the form's checks, which give each field the type
 * of its column.
 */
function withValues<T extends object>(record: T, values: EditValues): T {
  const changed: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const [name, value] of Object.entries(values)) {
    if (name in record) changed[name] = value;
  }
  return changed as T;
}

/**
 * A choice in the form that the database would refuse: the record it names is
 * gone, or can't go with the rest of the record. The route shows the form
 * again with what was typed, as it does for a refused save.
 */
function missingChoice(subject: RepositorySubject): RepositoryError {
  return new RepositoryError("invalid_reference", subject, { operation: "read" });
}

function sectionOf(pageType: PageRecord["pageType"]): ContentSection | undefined {
  return (Object.keys(READER_PAGE_TYPES) as ContentSection[]).find((section) =>
    (READER_PAGE_TYPES[section] as readonly string[]).includes(pageType),
  );
}

export function createPreviewService(
  catalogue: CatalogueService,
  content: ContentService,
  editing: EditService,
): PreviewService {
  /** The slug of the record as saved (it can't change), or the one being typed for a new record. */
  async function slugOf(
    key: EditEntityKey,
    id: number | undefined,
    values: EditValues,
  ): Promise<{ slug: string; saved: boolean }> {
    if (id === undefined) {
      return { slug: typeof values.slug === "string" ? values.slug : "", saved: false };
    }
    const stored = await editing.find(key, id);
    const slug = stored?.values.slug;
    if (stored === undefined || typeof slug !== "string") {
      // Same outcome as a missing record anywhere else in editing.
      throw new RepositoryError("not_found", ENTITY_TYPE[key], { operation: "read" });
    }
    return { slug, saved: true };
  }

  /** A vendor, as the tool page links to it, for a vendor chosen in the form. */
  async function vendorChosen(vendorId: unknown): Promise<VendorRecord | null> {
    if (typeof vendorId !== "number") return null;
    const found = await editing.find("vendors", vendorId);
    if (found === undefined) throw missingChoice("vendor");
    return withValues(blankVendor(), { ...found.values, id: vendorId });
  }

  /** The team that owns a page, as the page links to it, for a team chosen in the form. */
  async function ownerChosen(teamId: number | null): Promise<PageDetail["productTeamService"]> {
    if (teamId === null) return null;
    const found = await editing.find("services", teamId);
    const { slug, name } = found?.values ?? {};
    if (typeof slug !== "string" || typeof name !== "string") {
      throw missingChoice("product_team_service");
    }
    return { id: teamId, key: slug, slug, name };
  }

  async function toolChosen(toolId: unknown): Promise<InstanceDetail["tool"] | undefined> {
    if (typeof toolId !== "number") return undefined;
    const found = await editing.find("tools", toolId);
    const { slug, name } = found?.values ?? {};
    if (typeof slug !== "string" || typeof name !== "string") return undefined;
    return { id: toolId, key: slug, slug, name };
  }

  return {
    build: async (key, id, values) => {
      const [{ slug, saved }, groups] = await Promise.all([
        slugOf(key, id, values),
        catalogue.capabilityGroups(),
      ]);
      const typed: EditValues = { ...values, slug };

      switch (key) {
        case "vendors": {
          const base = saved ? await catalogue.vendor(slug) : undefined;
          const vendor = withValues(base?.vendor ?? blankVendor(), typed);
          return { kind: key, groups, detail: { vendor, tools: base?.tools ?? [] } };
        }

        case "tools": {
          const base = saved ? await catalogue.tool(slug) : undefined;
          const tool = withValues(base?.tool ?? blankTool(), { ...typed, key: slug });
          const vendor =
            tool.vendorId !== null && tool.vendorId === base?.vendor?.id
              ? base.vendor
              : await vendorChosen(tool.vendorId);
          return {
            kind: key,
            groups,
            detail: {
              tool,
              vendor,
              suppliers: base?.suppliers ?? [],
              contracts: base?.contracts ?? [],
              capabilities: base?.capabilities ?? [],
              instances: base?.instances ?? [],
              productTeamServices: base?.productTeamServices ?? [],
            },
          };
        }

        case "instances": {
          const base = saved ? await catalogue.instance(slug) : undefined;
          const instance = withValues(base?.instance ?? blankInstance(), { ...typed, key: slug });
          const tool =
            base?.tool.id === instance.toolId ? base.tool : await toolChosen(instance.toolId);
          if (tool === undefined) throw missingChoice("tool");
          // The contract can't be changed in the form, and the database only
          // accepts one for the instance's own tool, so a save would be refused.
          if (base !== undefined && base.contract !== null && base.tool.id !== instance.toolId) {
            throw missingChoice("contract");
          }
          return {
            kind: key,
            groups,
            detail: {
              instance,
              tool,
              contract: base?.contract ?? null,
              ownershipLevel: base?.ownershipLevel ?? null,
              targetOwnershipLevel: base?.targetOwnershipLevel ?? null,
              productTeamServices: base?.productTeamServices ?? [],
              capabilities: base?.capabilities ?? [],
            },
          };
        }

        case "services": {
          const base = saved ? await catalogue.productTeamService(slug) : undefined;
          const productTeamService = withValues(base?.productTeamService ?? blankTeam(), {
            ...typed,
            key: slug,
          });
          const guides =
            base === undefined ? [] : await content.serviceGuides(base.productTeamService.id);
          return {
            kind: key,
            groups,
            guides,
            detail: {
              productTeamService,
              businessUnits: base?.businessUnits ?? [],
              instances: base?.instances ?? [],
              capabilities: base?.capabilities ?? [],
            },
          };
        }

        case "pages": {
          const page = withValues(blankPage(), typed);
          const section = sectionOf(page.pageType);
          const owner = await ownerChosen(page.productTeamServiceId);
          return {
            kind: key,
            groups,
            section: section ?? "guidance",
            notShownToReaders: section === undefined,
            detail: {
              page,
              productTeamService: owner,
            },
          };
        }
      }
    },
  };
}
