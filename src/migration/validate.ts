import { z } from "zod";
import {
  CONTRACT_DATES_MESSAGE,
  businessUnitFields,
  capabilityFields,
  contractDatesInOrder,
  contractFields,
  instanceFields,
  keySchema,
  ownershipLevelFields,
  pageFields,
  productTeamServiceFields,
  redirectFields,
  toolFields,
} from "../validation/catalogue.js";
import type { MigrationRecord, TargetEntity, ValidationIssue } from "./records.js";

/**
 * Checks migration records before anything is loaded, collecting every
 * problem rather than stopping at the first: each record's values (with the
 * shared schemas), unique keys and slugs, and that every reference leads to a
 * record that exists. Issues never include a value.
 */

/** The shared schemas, plus the migration's references to other records by key. */
const RECORD_SCHEMAS: Readonly<Record<TargetEntity, z.ZodType>> = {
  ownership_level: z.strictObject(ownershipLevelFields),
  tool: z.strictObject(toolFields),
  contract: z
    .strictObject({ ...contractFields, toolKey: keySchema })
    .refine(contractDatesInOrder, CONTRACT_DATES_MESSAGE),
  instance: z.strictObject({
    ...instanceFields,
    toolKey: keySchema,
    ownershipLevelKey: keySchema.nullable(),
    targetOwnershipLevelKey: keySchema.nullable(),
    contractKey: keySchema.nullable(),
  }),
  capability: z.strictObject({ ...capabilityFields, toolKeys: z.array(keySchema) }),
  product_team_service: z.strictObject({
    ...productTeamServiceFields,
    usesToolKeys: z.array(keySchema),
  }),
  business_unit: z.strictObject({
    ...businessUnitFields,
    operatesKeys: z.array(keySchema),
    childKeys: z.array(keySchema),
  }),
  page: z.strictObject(pageFields),
  redirect: z.strictObject(redirectFields),
};

/** Record types whose slug must be unique as well as their key. */
const HAS_OWN_SLUG: ReadonlySet<TargetEntity> = new Set([
  "tool",
  "instance",
  "product_team_service",
  "page",
]);

interface Reference {
  readonly field: string;
  readonly target: TargetEntity;
}

/** The fields that refer to other records, in the order they are checked. */
const REFERENCES: Readonly<Partial<Record<TargetEntity, readonly Reference[]>>> = {
  instance: [
    { field: "toolKey", target: "tool" },
    { field: "ownershipLevelKey", target: "ownership_level" },
    { field: "targetOwnershipLevelKey", target: "ownership_level" },
    { field: "contractKey", target: "contract" },
  ],
  contract: [{ field: "toolKey", target: "tool" }],
  capability: [{ field: "toolKeys", target: "tool" }],
  product_team_service: [{ field: "usesToolKeys", target: "tool" }],
  business_unit: [
    { field: "operatesKeys", target: "product_team_service" },
    { field: "childKeys", target: "business_unit" },
  ],
};

const ENTITY_NAMES: Readonly<Record<TargetEntity, string>> = {
  ownership_level: "ownership level",
  tool: "tool",
  contract: "contract",
  instance: "instance",
  capability: "capability",
  product_team_service: "product, team or service",
  business_unit: "business unit",
  page: "page",
  redirect: "redirect",
};

function referencedKeys(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export function validateRecords(records: readonly MigrationRecord[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const keysOf = new Map<TargetEntity, Set<string>>();
  for (const record of records) {
    const keys = keysOf.get(record.targetEntity) ?? new Set<string>();
    keys.add(record.key);
    keysOf.set(record.targetEntity, keys);
  }
  const operatedTeams = new Set(
    records
      .filter((record) => record.targetEntity === "business_unit")
      .flatMap((record) => referencedKeys(record.fields.operatesKeys)),
  );

  // Each business unit's parent, from the units that list it as a child. The
  // loader sets parent_id from these, so a unit can only have one.
  const parentsOf = new Map<string, string[]>();
  for (const record of records) {
    if (record.targetEntity !== "business_unit") continue;
    for (const child of referencedKeys(record.fields.childKeys)) {
      parentsOf.set(child, [...(parentsOf.get(child) ?? []), record.key]);
    }
  }
  /** Whether following a unit's parents leads back to the unit itself. */
  const isInOwnChildren = (key: string): boolean => {
    const visited = new Set<string>();
    let current = parentsOf.get(key)?.[0];
    while (current !== undefined && !visited.has(current)) {
      if (current === key) return true;
      visited.add(current);
      current = parentsOf.get(current)?.[0];
    }
    return false;
  };

  const seenKeys = new Map<TargetEntity, Set<string>>();
  const seenSlugs = new Map<TargetEntity, Set<string>>();
  const seen = (map: Map<TargetEntity, Set<string>>, entity: TargetEntity): Set<string> => {
    const found = map.get(entity) ?? new Set<string>();
    map.set(entity, found);
    return found;
  };

  for (const record of records) {
    const { targetEntity, key } = record;
    const add = (message: string, field?: string) => {
      issues.push({
        sourcePath: record.sourcePath,
        sourceType: record.sourceType,
        targetEntity,
        key,
        ...(field === undefined ? {} : { field }),
        message,
      });
    };

    const result = RECORD_SCHEMAS[targetEntity].safeParse(record.fields);
    if (!result.success) {
      for (const problem of result.error.issues) {
        const [first] = problem.path;
        const field = first === undefined ? undefined : String(first);
        add(
          field === undefined
            ? problem.message
            : `${problem.path.map(String).join(".")} ${problem.message}`,
          field,
        );
      }
    }

    const keys = seen(seenKeys, targetEntity);
    if (keys.has(key)) {
      add(`another ${ENTITY_NAMES[targetEntity]} has the same key`, "key");
    } else {
      keys.add(key);
      if (HAS_OWN_SLUG.has(targetEntity)) {
        const slugs = seen(seenSlugs, targetEntity);
        if (slugs.has(record.slug))
          add(`another ${ENTITY_NAMES[targetEntity]} has the same slug`, "slug");
        slugs.add(record.slug);
      }
    }

    for (const { field, target } of REFERENCES[targetEntity] ?? []) {
      const known = keysOf.get(target) ?? new Set<string>();
      const missing = referencedKeys(record.fields[field]).filter((ref) => !known.has(ref));
      if (missing.length > 0) {
        add(
          `refers to ${ENTITY_NAMES[target]} keys that don't exist: ${missing.join(", ")}`,
          field,
        );
      }
    }

    if (targetEntity === "product_team_service" && !operatedTeams.has(key)) {
      add("no business unit operates it, which the current Hub requires", "key");
    }

    if (targetEntity === "business_unit") {
      const parents = parentsOf.get(key) ?? [];
      if (parents.length > 1) {
        add(`more than one business unit lists it as a child unit: ${parents.join(", ")}`, "key");
      } else if (isInOwnChildren(key)) {
        add("it is inside its own child units, directly or through other units", "childKeys");
      }
    }
  }
  return issues;
}
