import { z } from "zod";
import {
  CONTENT_STATUSES,
  MIGRATION_STATUSES,
  PAGE_TYPES,
  TOOL_KINDS,
  instanceFields,
  pageFields,
  productTeamServiceFields,
  toolFields,
  vendorFields,
} from "../validation/catalogue.js";

// What can be edited in the browser, and the form for each kind of record.
// This is configuration only: the form parser, the edit service and the
// templates all read it, so adding a kind of record means adding an entry
// here (and a repository, if it has none yet), not new code.

/** The repositories the editing pages read and write. */
export type EditEntityKey = "pages" | "tools" | "instances" | "vendors" | "services";

export type EditRepositoryName =
  "pages" | "tools" | "instances" | "vendors" | "productTeamServices";

interface FieldBase {
  /** The field's name in the form, and the record's column. */
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  /** What the value must be once read from the form, checked with the shared schemas. */
  readonly schema: z.ZodType;
}

/** A single line of text. Blank means "not set" unless the field is required. */
interface TextField extends FieldBase {
  readonly kind: "text";
  readonly required?: boolean;
  /** Characters allowed. The default suits any single line. */
  readonly maxLength?: number;
  /** "url" for a web address, which gets its own wording when it isn't valid. */
  readonly format?: "url";
  /** The width of the input. */
  readonly width?: "full" | "two-thirds";
}

/** Several lines of plain text, trimmed. */
interface TextareaField extends FieldBase {
  readonly kind: "textarea";
  readonly required?: boolean;
  readonly rows?: number;
}

/** Markdown, kept exactly as typed apart from line endings. */
interface MarkdownField extends FieldBase {
  readonly kind: "markdown";
  readonly required?: boolean;
  readonly rows?: number;
}

/** The record's address-safe identifier. It can be set when the record is added, never changed. */
interface SlugField extends FieldBase {
  readonly kind: "slug";
}

interface SelectField extends FieldBase {
  readonly kind: "select";
  readonly required?: boolean;
  readonly options: readonly { readonly value: string; readonly text: string }[];
  /** What a new record starts with. */
  readonly defaultValue?: string;
}

/** One record of another kind, chosen from a list. */
interface ChoiceField extends FieldBase {
  readonly kind: "choice";
  readonly required?: boolean;
  /** The kind of record to choose from. */
  readonly source: EditEntityKey;
}

interface CheckboxField extends FieldBase {
  readonly kind: "checkbox";
}

/** A calendar date typed as YYYY-MM-DD. */
interface DateField extends FieldBase {
  readonly kind: "date";
}

/** A whole number. */
interface IntegerField extends FieldBase {
  readonly kind: "integer";
}

/** One value per line. */
interface LinesField extends FieldBase {
  readonly kind: "lines";
}

export type EditField =
  | TextField
  | TextareaField
  | MarkdownField
  | SlugField
  | SelectField
  | ChoiceField
  | CheckboxField
  | DateField
  | IntegerField
  | LinesField;

export interface EditEntity {
  /** For example "vendor", in "Add a vendor". */
  readonly singular: string;
  /** For example "Vendors", the heading of the list and the link to it. */
  readonly plural: string;
  /** Said under the link on the index page. */
  readonly description: string;
  readonly repository: EditRepositoryName;
  /** The column shown as the record's name. */
  readonly titleField: "name" | "title";
  /** Copy the slug into the `key` column when a record is added (records addressed by both). */
  readonly keyFromSlug?: boolean;
  readonly fields: readonly EditField[];
}

function options<T extends string>(
  values: readonly T[],
  text: Readonly<Record<T, string>>,
): { value: T; text: string }[] {
  return values.map((value) => ({ value, text: text[value] }));
}

const PAGE_TYPE_OPTIONS = options(PAGE_TYPES, {
  policy: "Policy",
  service_guide: "Service guide",
  guidance: "Guidance",
  general: "General",
  whats_new: "What’s new",
});

const CONTENT_STATUS_OPTIONS = options(CONTENT_STATUSES, {
  draft: "Draft (not shown to readers)",
  published: "Published",
});

const MIGRATION_STATUS_OPTIONS = options(MIGRATION_STATUSES, {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  not_applicable: "Not applicable",
});

const TOOL_KIND_OPTIONS = options(TOOL_KINDS, {
  engineering: "Engineering",
  business: "Business",
});

const DATE_HINT = "Use the format YYYY-MM-DD, for example 2026-07-15.";
const URL_HINT = "Start with https:// or http://.";
const SLUG_HINT =
  "Lower-case words separated by hyphens, for example “device-rules”. It forms the address and can’t be changed later.";

export const EDIT_ENTITIES = {
  pages: {
    singular: "page",
    plural: "Pages",
    description: "Policies, guidance, service guides and other written pages.",
    repository: "pages",
    titleField: "title",
    fields: [
      { kind: "slug", name: "slug", label: "Slug", hint: SLUG_HINT, schema: pageFields.slug },
      {
        kind: "text",
        name: "title",
        label: "Title",
        required: true,
        maxLength: 255,
        schema: pageFields.title,
      },
      {
        kind: "select",
        name: "pageType",
        label: "Page type",
        required: true,
        options: PAGE_TYPE_OPTIONS,
        schema: pageFields.pageType,
      },
      {
        kind: "textarea",
        name: "summary",
        label: "Summary",
        hint: "A sentence or two, shown above the page.",
        rows: 3,
        schema: pageFields.summary,
      },
      {
        kind: "markdown",
        name: "bodyMarkdown",
        label: "Body",
        hint: "Written in markdown.",
        required: true,
        rows: 20,
        schema: z.string().min(1),
      },
      {
        kind: "text",
        name: "ownerName",
        label: "Owner",
        maxLength: 255,
        schema: pageFields.ownerName,
      },
      {
        kind: "text",
        name: "ownerContact",
        label: "Owner contact",
        hint: "An email address or web address.",
        schema: pageFields.ownerContact,
      },
      {
        kind: "choice",
        name: "productTeamServiceId",
        label: "Product, team or service",
        hint: "The team that owns the page, if there is one.",
        source: "services",
        schema: z.number().int().positive().nullable(),
      },
      {
        kind: "select",
        name: "status",
        label: "Status",
        hint: "Only published pages are shown to readers.",
        required: true,
        options: CONTENT_STATUS_OPTIONS,
        defaultValue: "draft",
        schema: pageFields.status,
      },
      {
        kind: "date",
        name: "lastReviewedAt",
        label: "Last reviewed",
        hint: DATE_HINT,
        schema: pageFields.lastReviewedAt,
      },
    ],
  },
  tools: {
    singular: "tool",
    plural: "Tools",
    description: "Software used across GDS.",
    repository: "tools",
    titleField: "name",
    keyFromSlug: true,
    fields: [
      { kind: "slug", name: "slug", label: "Slug", hint: SLUG_HINT, schema: toolFields.slug },
      { kind: "text", name: "name", label: "Name", required: true, schema: toolFields.name },
      {
        kind: "textarea",
        name: "description",
        label: "Description",
        schema: toolFields.description,
      },
      {
        kind: "select",
        name: "engineeringOrBusinessTool",
        label: "Kind of tool",
        options: TOOL_KIND_OPTIONS,
        schema: toolFields.engineeringOrBusinessTool,
      },
      {
        kind: "choice",
        name: "vendorId",
        label: "Vendor",
        source: "vendors",
        schema: z.number().int().positive().nullable(),
      },
    ],
  },
  instances: {
    singular: "instance",
    plural: "Instances",
    description: "A deployment, account or workspace of a tool.",
    repository: "instances",
    titleField: "name",
    keyFromSlug: true,
    fields: [
      { kind: "slug", name: "slug", label: "Slug", hint: SLUG_HINT, schema: instanceFields.slug },
      { kind: "text", name: "name", label: "Name", required: true, schema: instanceFields.name },
      {
        kind: "choice",
        name: "toolId",
        label: "Tool",
        required: true,
        source: "tools",
        schema: z.number().int().positive(),
      },
      {
        kind: "text",
        name: "url",
        label: "Web address",
        hint: URL_HINT,
        format: "url",
        width: "two-thirds",
        schema: instanceFields.url,
      },
      {
        kind: "textarea",
        name: "description",
        label: "Description",
        schema: instanceFields.description,
      },
      {
        kind: "textarea",
        name: "gettingAccess",
        label: "Getting access",
        schema: instanceFields.gettingAccess,
      },
      {
        kind: "textarea",
        name: "management",
        label: "Management",
        schema: instanceFields.management,
      },
      {
        kind: "textarea",
        name: "authentication",
        label: "Authentication",
        schema: instanceFields.authentication,
      },
      {
        kind: "textarea",
        name: "userProvisioning",
        label: "User provisioning",
        schema: instanceFields.userProvisioning,
      },
      { kind: "textarea", name: "support", label: "Support", schema: instanceFields.support },
      {
        kind: "textarea",
        name: "escalationContact",
        label: "Escalation contact",
        schema: instanceFields.escalationContact,
      },
      {
        kind: "checkbox",
        name: "supportedByGdsSoftwareServiceDesk",
        label: "Supported by the GDS software service desk",
        schema: instanceFields.supportedByGdsSoftwareServiceDesk,
      },
      {
        kind: "checkbox",
        name: "notInUse",
        label: "Not in use",
        schema: instanceFields.notInUse,
      },
      {
        kind: "checkbox",
        name: "isPlaceholder",
        label: "Placeholder for the tool’s own settings",
        schema: instanceFields.isPlaceholder,
      },
      {
        kind: "select",
        name: "migrationStatus",
        label: "Migration status",
        required: true,
        options: MIGRATION_STATUS_OPTIONS,
        defaultValue: "not_started",
        schema: instanceFields.migrationStatus,
      },
      {
        kind: "date",
        name: "migrationDate",
        label: "Migration date",
        hint: DATE_HINT,
        schema: instanceFields.migrationDate,
      },
      {
        kind: "date",
        name: "lastReviewedAt",
        label: "Last reviewed",
        hint: DATE_HINT,
        schema: instanceFields.lastReviewedAt,
      },
    ],
  },
  vendors: {
    singular: "vendor",
    plural: "Vendors",
    description: "The companies that make the tools.",
    repository: "vendors",
    titleField: "name",
    fields: [
      { kind: "slug", name: "slug", label: "Slug", hint: SLUG_HINT, schema: vendorFields.slug },
      { kind: "text", name: "name", label: "Name", required: true, schema: vendorFields.name },
      {
        kind: "textarea",
        name: "description",
        label: "Description",
        schema: vendorFields.description,
      },
      {
        kind: "text",
        name: "url",
        label: "Web address",
        hint: URL_HINT,
        format: "url",
        width: "two-thirds",
        schema: vendorFields.url,
      },
      {
        kind: "textarea",
        name: "supportContact",
        label: "Support contact",
        schema: vendorFields.supportContact,
      },
      {
        kind: "textarea",
        name: "dataProtectionContact",
        label: "Data protection contact",
        schema: vendorFields.dataProtectionContact,
      },
    ],
  },
  services: {
    singular: "service",
    plural: "Services",
    description: "Products, teams and services.",
    repository: "productTeamServices",
    titleField: "name",
    keyFromSlug: true,
    fields: [
      {
        kind: "slug",
        name: "slug",
        label: "Slug",
        hint: SLUG_HINT,
        schema: productTeamServiceFields.slug,
      },
      {
        kind: "text",
        name: "name",
        label: "Name",
        required: true,
        schema: productTeamServiceFields.name,
      },
      {
        kind: "textarea",
        name: "purpose",
        label: "Purpose",
        hint: "What it does.",
        schema: productTeamServiceFields.purpose,
      },
      {
        kind: "text",
        name: "url",
        label: "Web address",
        hint: URL_HINT,
        format: "url",
        width: "two-thirds",
        schema: productTeamServiceFields.url,
      },
      {
        kind: "text",
        name: "slackChannel",
        label: "Slack channel web address",
        hint: URL_HINT,
        format: "url",
        width: "two-thirds",
        schema: productTeamServiceFields.slackChannel,
      },
      {
        kind: "text",
        name: "slackChannelName",
        label: "Slack channel name",
        schema: productTeamServiceFields.slackChannelName,
      },
      {
        kind: "text",
        name: "teamEmailAddress",
        label: "Team email address",
        schema: productTeamServiceFields.teamEmailAddress,
      },
      {
        kind: "lines",
        name: "ghOrgs",
        label: "GitHub organisations",
        hint: "Enter one name on each line.",
        schema: productTeamServiceFields.ghOrgs,
      },
      {
        kind: "textarea",
        name: "escalationContact",
        label: "Escalation contact",
        schema: productTeamServiceFields.escalationContact,
      },
      {
        kind: "date",
        name: "lastReviewedAt",
        label: "Last reviewed",
        hint: DATE_HINT,
        schema: productTeamServiceFields.lastReviewedAt,
      },
      {
        kind: "integer",
        name: "weight",
        label: "Weight",
        hint: "A whole number. Lower numbers are listed first.",
        schema: productTeamServiceFields.weight,
      },
    ],
  },
} as const satisfies Record<EditEntityKey, EditEntity>;

/** What a form field holds: text, a record's id, a tick box, one value per line, or nothing. */
export type EditValue = string | number | boolean | readonly string[] | null;

/** A record's values, or the values to save, keyed by form field name. */
export type EditValues = Readonly<Record<string, EditValue>>;

/** The kinds of record that can be edited, in the order they are listed. */
export const EDIT_ENTITY_KEYS = Object.keys(EDIT_ENTITIES) as readonly EditEntityKey[];

/** The kind of record for a route's `:entity`, if it is one that can be edited. */
export function editEntityFrom(value: unknown): EditEntityKey | undefined {
  return typeof value === "string" && Object.hasOwn(EDIT_ENTITIES, value)
    ? (value as EditEntityKey)
    : undefined;
}
