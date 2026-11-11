/** Anything with a navigation weight and a name, such as a capability. */
export interface Weighted {
  readonly id: number;
  readonly name: string;
  /** Lower weights come first. Records with no weight come after those with one. */
  readonly weight: number | null;
}

/** A capability as the navigation needs it. */
export interface NavigableCapability extends Weighted {
  /** A plain label. Blank or missing means the capability has no group. */
  readonly groupName: string | null;
  readonly hideInNavigation: boolean;
}

export interface CapabilityGroup<T extends NavigableCapability = NavigableCapability> {
  /** The group's label, or null for the capabilities that have no group. */
  readonly name: string | null;
  /** By weight (no weight last), then name. */
  readonly capabilities: readonly T[];
}

const names = new Intl.Collator("en-GB");

/** Orders by weight (no weight last), then name, then id, so the order is always the same. */
export function compareByWeightThenName(a: Weighted, b: Weighted): number {
  if (a.weight !== b.weight) {
    if (a.weight === null) return 1;
    if (b.weight === null) return -1;
    return a.weight - b.weight;
  }
  return names.compare(a.name, b.name) || a.id - b.id;
}

function groupNameOf(capability: NavigableCapability): string | null {
  const name = capability.groupName?.trim() ?? "";
  return name === "" ? null : name;
}

function compareGroups<T extends NavigableCapability>(
  a: CapabilityGroup<T>,
  b: CapabilityGroup<T>,
): number {
  // Capabilities with no group come last.
  if (a.name === null) return b.name === null ? 0 : 1;
  if (b.name === null) return -1;
  // Each group's capabilities are already sorted, so the first has the lowest weight.
  const aWeight = a.capabilities[0]?.weight ?? null;
  const bWeight = b.capabilities[0]?.weight ?? null;
  if (aWeight !== bWeight) {
    if (aWeight === null) return 1;
    if (bWeight === null) return -1;
    return aWeight - bWeight;
  }
  return names.compare(a.name, b.name);
}

/**
 * The capabilities to show in navigation, grouped by their group name.
 *
 * - Capabilities set to hide in navigation are left out. Their own pages still work.
 * - In each group, capabilities are in weight order (no weight last), then name order.
 * - Groups are in the order of their lowest-weighted capability, then name
 *   order. Capabilities with no group come last, in a group with a null name.
 * - Groups match on the trimmed label, so "Delivery" and "Delivery " are one group.
 */
export function groupCapabilitiesForNavigation<T extends NavigableCapability>(
  capabilities: readonly T[],
): CapabilityGroup<T>[] {
  const visible = capabilities
    .filter((capability) => !capability.hideInNavigation)
    .sort(compareByWeightThenName);

  const byGroup = new Map<string | null, T[]>();
  for (const capability of visible) {
    const name = groupNameOf(capability);
    const members = byGroup.get(name) ?? [];
    members.push(capability);
    byGroup.set(name, members);
  }

  return [...byGroup.entries()]
    .map(([name, members]): CapabilityGroup<T> => ({ name, capabilities: members }))
    .sort(compareGroups);
}
