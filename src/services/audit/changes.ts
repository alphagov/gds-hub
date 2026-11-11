/**
 * Comparing records to find what a change altered. Pure functions with no
 * database access, used by the repositories when they write audit entries.
 */

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !isList(value) && !(value instanceof Date);
}

function isMissing(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Whether two field values are the same, as the database would store them:
 * - null and a missing value are the same
 * - dates are compared by the time they hold
 * - objects (jsonb) are compared key by key, in any order
 * - lists are compared item by item, in order
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isMissing(a) || isMissing(b)) return isMissing(a) && isMissing(b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (isList(a) || isList(b)) {
    return (
      isList(a) &&
      isList(b) &&
      a.length === b.length &&
      a.every((item, index) => valuesEqual(item, b[index]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && valuesEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * The names of the fields whose values differ between two versions of a
 * record, in the order they appear in `after` (then any only in `before`).
 * Fields listed in `ignore` are left out.
 */
export function changedFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  ignore: readonly string[] = [],
): string[] {
  const ignored = new Set(ignore);
  const keys = [
    ...Object.keys(after),
    ...Object.keys(before).filter((key) => !Object.hasOwn(after, key)),
  ];
  return keys.filter((key) => !ignored.has(key) && !valuesEqual(before[key], after[key]));
}
