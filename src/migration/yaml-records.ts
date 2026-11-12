import path from "node:path";
import { CORE_SCHEMA, YAMLException, load } from "js-yaml";
import {
  warning,
  type MigrationRecord,
  type MigrationWarning,
  type TargetEntity,
  type ValidationIssue,
} from "./records.js";
import { YamlValues, extraAttributeText, normaliseKey } from "./yaml-values.js";

/**
 * Turns the current Hub's YAML data files into migration records. Every
 * value goes to a column, an instance's extra attributes, or a warning: none
 * is silently dropped. References between records stay as keys until the
 * loader resolves them.
 */

export interface DataFile {
  /** The file's path relative to the data folder, for example "tools.yml". */
  readonly sourcePath: string;
  readonly text: string;
}

export interface YamlResult {
  readonly records: MigrationRecord[];
  readonly issues: ValidationIssue[];
  /** Data files the migration doesn't know how to read. */
  readonly unknownFiles: string[];
  /** Warnings about a whole data file, such as a key given twice, by its path. */
  readonly fileWarnings: ReadonlyMap<string, readonly MigrationWarning[]>;
}

type YamlEntity = Extract<
  TargetEntity,
  "tool" | "instance" | "capability" | "ownership_level" | "product_team_service" | "business_unit"
>;

/** The data files the current Hub has, by name without the extension. */
export const DATA_FILE_ENTITIES: Readonly<Record<string, YamlEntity>> = {
  tools: "tool",
  instances: "instance",
  capabilities: "capability",
  ownership_levels: "ownership_level",
  products_teams_and_services: "product_team_service",
  business_units: "business_unit",
};

/** The level the current Hub falls back to when a tool doesn't set one. */
export const FALLBACK_OWNERSHIP_LEVEL = "undocumented";

const set = (...fields: string[]): ReadonlySet<string> => new Set(fields);

/**
 * Tool fields with no column of their own. They are kept as the placeholder
 * instance's extra attributes, so nothing is lost.
 */
const TOOL_EXTRA_FIELDS = [
  "technical_lead",
  "dpia_url",
  "has_had_data_protection_impact_assessment",
  "gds_domain_restricted_sso",
];

const TOOL_FIELDS = set(
  "name",
  "description",
  "url",
  "engineering_or_business_tool",
  "management",
  "getting_access",
  "supported_by_gds_software_service_desk",
  "operational_policy",
  "ownership_level",
  "target_ownership_level",
  "identity_migration_status",
  "migration_date",
  "not_in_use",
  "data_protection_and_security",
  "support",
  "total_users",
  "cost_model",
  "commercials",
  "license_start_date",
  "license_end_date",
  "license_cost",
  "license_terms",
  "escalation_contact",
  "last_updated",
  ...TOOL_EXTRA_FIELDS,
);
/** Only set the current Hub's navigation or grouping, which the new Hub works out itself. */
const TOOL_IGNORED = set("weight", "group");

const CONTRACT_FIELDS = [
  "license_start_date",
  "license_end_date",
  "license_cost",
  "license_terms",
  "cost_model",
  "commercials",
  "total_users",
  "operational_policy",
  "data_protection_and_security",
];

/** Instance fields with their own column. Everything else becomes an extra attribute. */
const INSTANCE_COLUMNS = set(
  "tool",
  "name",
  "url",
  "description",
  "getting_access",
  "management",
  "authentication",
  "user_provisioning",
  "support",
  "escalation_contact",
  "supported_by_gds_software_service_desk",
  "not_in_use",
  "identity_migration_status",
  "migration_status",
  "migration_date",
  "ownership_level",
  "target_ownership_level",
  "last_updated",
);
const INSTANCE_IGNORED = set("weight");

const CAPABILITY_FIELDS = set(
  "name",
  "description",
  "group",
  "tools",
  "comment",
  "weight",
  "hide_in_navigation",
);
const OWNERSHIP_LEVEL_FIELDS = set(
  "name",
  "definition",
  "description",
  "target_state",
  "weight",
  "hide_in_navigation",
);
const TEAM_FIELDS = set(
  "name",
  "purpose",
  "url",
  "slack_channel",
  "slack_channel_name",
  "team_email_address",
  "uses",
  "gh_orgs",
  "escalation_contact",
  "last_updated",
  "weight",
);
const BUSINESS_UNIT_FIELDS = set(
  "child_units",
  "name",
  "level",
  "description",
  "lead",
  "url",
  "operates",
  "escalation_contact",
  "weight",
);
const NONE = set();

interface Entry {
  readonly entity: YamlEntity;
  readonly sourcePath: string;
  readonly key: string;
  readonly values: Readonly<Record<string, unknown>>;
  /** Warnings about the record itself, found while reading the file. */
  readonly warnings: readonly MigrationWarning[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fileIssue(sourcePath: string, message: string, key?: string): ValidationIssue {
  return key === undefined
    ? { sourcePath, sourceType: "yaml", message }
    : { sourcePath, sourceType: "yaml", key, message };
}

/** The parser's reason and the line it stopped at. Never its message, which quotes the file. */
function describeParseError(error: unknown): { reason: string; line: number | undefined } {
  if (error instanceof YAMLException) {
    const line = error.mark?.line;
    return { reason: error.reason, line: line === undefined ? undefined : line + 1 };
  }
  return { reason: "the parser failed", line: undefined };
}

const DUPLICATED_KEY = "duplicated mapping key";

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/**
 * Parses a data file. Ruby's YAML parser, which the current Hub uses, keeps
 * the last of two identical keys without a word. js-yaml refuses them, so the
 * file is parsed again keeping the last value, as on the current Hub, and
 * flagged so a person checks which one is right.
 */
function parseDataFile(
  file: DataFile,
  issues: ValidationIssue[],
  fileWarnings: MigrationWarning[],
): Parsed {
  try {
    return { ok: true, value: load(file.text, { schema: CORE_SCHEMA }) };
  } catch (error) {
    const { reason, line } = describeParseError(error);
    const at = line === undefined ? "" : ` at line ${line}`;
    if (reason === DUPLICATED_KEY) {
      try {
        const value = load(file.text, { schema: CORE_SCHEMA, json: true });
        fileWarnings.push(
          warning(
            "duplicate_key",
            `a key appears more than once, first repeated${at}, so the last value is used, as on the current Hub`,
          ),
        );
        return { ok: true, value };
      } catch (second) {
        const again = describeParseError(second);
        const againAt = again.line === undefined ? "" : ` at line ${again.line}`;
        issues.push(
          fileIssue(file.sourcePath, `the file isn't valid YAML: ${again.reason}${againAt}`),
        );
        return { ok: false };
      }
    }
    issues.push(fileIssue(file.sourcePath, `the file isn't valid YAML: ${reason}${at}`));
    return { ok: false };
  }
}

/**
 * The lines (from 1) of each record key given more than once at the top of a
 * file. Only plain, unindented keys are found, which is how the current Hub's
 * data files are written.
 */
function duplicatedRecordKeys(text: string): ReadonlyMap<string, readonly number[]> {
  const lines = new Map<string, number[]>();
  text.split(/\r?\n/).forEach((line, index) => {
    const key = /^([^\s#:'"{[\]&*!|>%@`-][^:#]*?):(\s|$)/.exec(line)?.[1]?.trim();
    if (key === undefined) return;
    const found = lines.get(key) ?? [];
    found.push(index + 1);
    lines.set(key, found);
  });
  return new Map([...lines].filter(([, at]) => at.length > 1));
}

function listLines(lines: readonly number[]): string {
  if (lines.length === 1) return `line ${lines[0] ?? ""}`;
  return `lines ${lines.slice(0, -1).join(", ")} and ${lines[lines.length - 1] ?? ""}`;
}

/**
 * The records in a data file. It is a map of key to record, as the current
 * Hub uses, or a single top-level key holding a list of records that each
 * have a "key" (or "id").
 */
function readEntries(
  entity: YamlEntity,
  file: DataFile,
  issues: ValidationIssue[],
  fileWarnings: MigrationWarning[],
): Entry[] {
  const result = parseDataFile(file, issues, fileWarnings);
  if (!result.ok) return [];
  const parsed = result.value;
  if (parsed === undefined || parsed === null) return [];
  if (!isPlainObject(parsed)) {
    issues.push(
      fileIssue(file.sourcePath, "the file must be a set of records keyed by their identifier"),
    );
    return [];
  }

  const topLevel = Object.entries(parsed);
  const [only] = topLevel;
  if (topLevel.length === 1 && only !== undefined && Array.isArray(only[1])) {
    return (only[1] as unknown[]).flatMap((item, index): Entry[] => {
      const key = isPlainObject(item) ? (item.key ?? item.id) : undefined;
      if (!isPlainObject(item) || typeof key !== "string" || key.trim() === "") {
        issues.push(fileIssue(file.sourcePath, `item ${index + 1} needs a key`));
        return [];
      }
      return [{ entity, sourcePath: file.sourcePath, key: key.trim(), values: item, warnings: [] }];
    });
  }

  const duplicates =
    fileWarnings.length > 0
      ? duplicatedRecordKeys(file.text)
      : new Map<string, readonly number[]>();
  return topLevel.flatMap(([key, values]): Entry[] => {
    if (!isPlainObject(values)) {
      issues.push(fileIssue(file.sourcePath, "the record must be a set of named values", key));
      return [];
    }
    const lines = duplicates.get(key);
    const warnings =
      lines === undefined
        ? []
        : [
            warning(
              "duplicate_key",
              `this key is given more than once in the file, on ${listLines(lines)}, so the last one is used, as on the current Hub`,
            ),
          ];
    return [{ entity, sourcePath: file.sourcePath, key, values, warnings }];
  });
}

function makeRecord(
  values: YamlValues,
  targetEntity: TargetEntity,
  key: string,
  fields: Record<string, unknown>,
): MigrationRecord {
  return {
    sourcePath: values.sourcePath,
    sourceType: "yaml",
    targetEntity,
    key,
    slug: key,
    fields,
    warnings: [...values.warnings],
  };
}

interface Context {
  readonly toolKeys: ReadonlySet<string>;
  readonly instanceKeys: ReadonlySet<string>;
  readonly issues: ValidationIssue[];
}

/** A tool, the placeholder instance holding its own settings, and its contract if it has one. */
function toolRecords(entry: Entry, context: Context): MigrationRecord[] {
  const { key, sourcePath, values } = entry;

  const tool = new YamlValues(sourcePath, "tool", key, values);
  tool.warnings.push(...entry.warnings);
  tool.checkFields(TOOL_FIELDS, TOOL_IGNORED);
  const name = tool.name();
  const toolRecord = makeRecord(tool, "tool", key, {
    key,
    slug: key,
    name,
    description: tool.text("description"),
    engineeringOrBusinessTool: tool.toolKind("engineering_or_business_tool"),
  });

  const hasContract = CONTRACT_FIELDS.some((field) => tool.has(field));
  const records: MigrationRecord[] = [toolRecord];

  const placeholderKey = context.instanceKeys.has(key) ? `${key}-tool` : key;
  const placeholder = new YamlValues(sourcePath, "instance", key, values, true);
  const placeholderFields = {
    key: placeholderKey,
    slug: placeholderKey,
    name,
    toolKey: key,
    isPlaceholder: true,
    url: placeholder.url("url"),
    description: null,
    gettingAccess: placeholder.text("getting_access"),
    management: placeholder.text("management"),
    authentication: null,
    userProvisioning: null,
    support: placeholder.text("support"),
    escalationContact: placeholder.text("escalation_contact"),
    supportedByGdsSoftwareServiceDesk: placeholder.bool("supported_by_gds_software_service_desk"),
    notInUse: placeholder.bool("not_in_use"),
    migrationStatus: placeholder.migrationStatus("identity_migration_status"),
    migrationDate: placeholder.date("migration_date"),
    ownershipLevelKey: placeholder.ownershipLevel("ownership_level", FALLBACK_OWNERSHIP_LEVEL),
    targetOwnershipLevelKey: placeholder.ownershipLevel(
      "target_ownership_level",
      FALLBACK_OWNERSHIP_LEVEL,
    ),
    contractKey: hasContract ? key : null,
    extraAttributes: placeholder.extras,
    lastReviewedAt: placeholder.date("last_updated"),
  };
  for (const field of TOOL_EXTRA_FIELDS) {
    const { text, complex } = extraAttributeText(values[field]);
    if (text === undefined) continue;
    placeholder.extras[field] = text;
    if (complex) {
      placeholder.warnings.push(
        warning("complex_value", `${field} is a nested value, so it was kept as JSON text`),
      );
    }
  }
  records.push(makeRecord(placeholder, "instance", placeholderKey, placeholderFields));
  context.issues.push(...placeholder.issues);

  if (hasContract) {
    const contract = new YamlValues(sourcePath, "contract", key, values);
    records.push(
      makeRecord(contract, "contract", key, {
        toolKey: key,
        startDate: contract.date("license_start_date"),
        endDate: contract.date("license_end_date"),
        cost: contract.text("license_cost"),
        licenseTerms: contract.text("license_terms"),
        costModel: contract.text("cost_model"),
        commercials: contract.text("commercials"),
        totalUsers: contract.text("total_users"),
        operationalPolicy: contract.text("operational_policy"),
        dataProtectionAndSecurity: contract.text("data_protection_and_security"),
      }),
    );
    context.issues.push(...contract.issues);
  }
  context.issues.push(...tool.issues);
  return records;
}

function instanceRecord(entry: Entry, context: Context): MigrationRecord {
  const { key, sourcePath, values } = entry;
  const instance = new YamlValues(sourcePath, "instance", key, values, true);
  instance.warnings.push(...entry.warnings);
  // Every field is migrated (as a column or an extra attribute) except those
  // that only set the current Hub's navigation.
  instance.checkFields(
    new Set(Object.keys(values).filter((field) => !INSTANCE_IGNORED.has(field))),
    INSTANCE_IGNORED,
  );

  const toolKey = instance.text("tool");
  if (toolKey === null) {
    instance.issue("tool", "tool must be set to the key of the instance's tool");
  } else if (!context.toolKeys.has(toolKey)) {
    // The current Hub matched instances to tools by substring, both ways.
    const partial = [...context.toolKeys].some(
      (tool) => tool.includes(toolKey) || toolKey.includes(tool),
    );
    if (partial) {
      instance.warnings.push(
        warning(
          "substring_tool_match",
          "tool only matches a tool by part of its key, which the current Hub allowed but the migration doesn't",
        ),
      );
    }
  }

  const fields: Record<string, unknown> = {
    key,
    slug: key,
    name: instance.name(),
    toolKey: toolKey ?? "",
    isPlaceholder: false,
    url: instance.url("url"),
    description: instance.text("description"),
    gettingAccess: instance.text("getting_access"),
    management: instance.text("management"),
    authentication: instance.text("authentication"),
    userProvisioning: instance.text("user_provisioning"),
    support: instance.text("support"),
    escalationContact: instance.text("escalation_contact"),
    supportedByGdsSoftwareServiceDesk: instance.bool("supported_by_gds_software_service_desk"),
    notInUse: instance.bool("not_in_use"),
    migrationStatus: instance.migrationStatus(
      instance.has("identity_migration_status") ? "identity_migration_status" : "migration_status",
    ),
    migrationDate: instance.date("migration_date"),
    ownershipLevelKey: instance.ownershipLevel("ownership_level"),
    targetOwnershipLevelKey: instance.ownershipLevel("target_ownership_level"),
    contractKey: null,
    extraAttributes: instance.extras,
    lastReviewedAt: instance.date("last_updated"),
  };

  // Every other field was shown as a row on the instance page, so it is kept.
  for (const [field, value] of Object.entries(values)) {
    if (
      INSTANCE_COLUMNS.has(field) ||
      INSTANCE_IGNORED.has(field) ||
      field === "key" ||
      field === "id"
    ) {
      continue;
    }
    const { text, complex } = extraAttributeText(value);
    if (text === undefined) continue;
    instance.extras[field] = text;
    if (complex) {
      instance.warnings.push(
        warning("complex_value", `${field} is a nested value, so it was kept as JSON text`),
      );
    }
  }

  context.issues.push(...instance.issues);
  return makeRecord(instance, "instance", key, fields);
}

function capabilityRecord(entry: Entry, context: Context): MigrationRecord {
  const { key, sourcePath, values } = entry;
  const capability = new YamlValues(sourcePath, "capability", key, values);
  capability.warnings.push(...entry.warnings);
  capability.checkFields(CAPABILITY_FIELDS, NONE);
  const fields = {
    key,
    name: capability.name(),
    description: capability.text("description"),
    groupName: capability.text("group"),
    comment: capability.text("comment"),
    weight: capability.int("weight"),
    hideInNavigation: capability.bool("hide_in_navigation"),
    toolKeys: capability.list("tools", false),
  };
  context.issues.push(...capability.issues);
  return makeRecord(capability, "capability", key, fields);
}

function ownershipLevelRecord(entry: Entry, context: Context): MigrationRecord {
  const key = normaliseKey(entry.key);
  const level = new YamlValues(entry.sourcePath, "ownership_level", key, entry.values);
  level.warnings.push(...entry.warnings);
  level.checkFields(OWNERSHIP_LEVEL_FIELDS, NONE);
  const fields = {
    key,
    name: level.name(),
    definition: level.text("definition"),
    description: level.text("description"),
    targetState: level.text("target_state"),
    weight: level.int("weight"),
    hideInNavigation: level.bool("hide_in_navigation"),
  };
  context.issues.push(...level.issues);
  return makeRecord(level, "ownership_level", key, fields);
}

function teamRecord(entry: Entry, context: Context): MigrationRecord {
  const { key, sourcePath, values } = entry;
  const team = new YamlValues(sourcePath, "product_team_service", key, values);
  team.warnings.push(...entry.warnings);
  team.checkFields(TEAM_FIELDS, NONE);
  const fields = {
    key,
    slug: key,
    name: team.name(),
    purpose: team.text("purpose"),
    url: team.url("url"),
    slackChannel: team.url("slack_channel"),
    slackChannelName: team.text("slack_channel_name"),
    teamEmailAddress: team.text("team_email_address"),
    ghOrgs: team.githubOrgs("gh_orgs"),
    escalationContact: team.text("escalation_contact"),
    lastReviewedAt: team.date("last_updated"),
    weight: team.int("weight"),
    usesToolKeys: team.list("uses", true),
  };
  context.issues.push(...team.issues);
  return makeRecord(team, "product_team_service", key, fields);
}

function businessUnitRecord(entry: Entry, context: Context): MigrationRecord {
  const { key, sourcePath, values } = entry;
  const unit = new YamlValues(sourcePath, "business_unit", key, values);
  unit.warnings.push(...entry.warnings);
  unit.checkFields(BUSINESS_UNIT_FIELDS, NONE);
  const fields = {
    key,
    name: unit.name(),
    level: unit.text("level"),
    description: unit.text("description"),
    lead: unit.text("lead"),
    url: unit.url("url"),
    escalationContact: unit.text("escalation_contact"),
    weight: unit.int("weight"),
    operatesKeys: unit.list("operates", true),
    childKeys: unit.list("child_units", false),
  };
  context.issues.push(...unit.issues);
  return makeRecord(unit, "business_unit", key, fields);
}

/** The data file's record type, from its name without the extension. */
export function entityOfDataFile(sourcePath: string): YamlEntity | undefined {
  const name = path.posix.basename(sourcePath).replace(/\.ya?ml$/i, "");
  return Object.hasOwn(DATA_FILE_ENTITIES, name) ? DATA_FILE_ENTITIES[name] : undefined;
}

/** Reads every data file into records, in file order. */
export function recordsFromYaml(files: readonly DataFile[]): YamlResult {
  const issues: ValidationIssue[] = [];
  const unknownFiles: string[] = [];
  const fileWarnings = new Map<string, MigrationWarning[]>();
  const entries: Entry[] = [];

  for (const file of files) {
    const entity = entityOfDataFile(file.sourcePath);
    if (entity === undefined) {
      unknownFiles.push(file.sourcePath);
      continue;
    }
    const warnings: MigrationWarning[] = [];
    entries.push(...readEntries(entity, file, issues, warnings));
    if (warnings.length > 0) fileWarnings.set(file.sourcePath, warnings);
  }

  const context: Context = {
    toolKeys: new Set(entries.filter((e) => e.entity === "tool").map((e) => e.key)),
    instanceKeys: new Set(entries.filter((e) => e.entity === "instance").map((e) => e.key)),
    issues,
  };

  const records = entries.flatMap((entry): MigrationRecord[] => {
    switch (entry.entity) {
      case "tool":
        return toolRecords(entry, context);
      case "instance":
        return [instanceRecord(entry, context)];
      case "capability":
        return [capabilityRecord(entry, context)];
      case "ownership_level":
        return [ownershipLevelRecord(entry, context)];
      case "product_team_service":
        return [teamRecord(entry, context)];
      case "business_unit":
        return [businessUnitRecord(entry, context)];
    }
  });

  return { records, issues, unknownFiles, fileWarnings };
}
