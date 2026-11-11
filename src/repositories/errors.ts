import type { EntityType } from "../db/entity-types.js";

export type RepositoryErrorKind =
  "not_found" | "duplicate" | "in_use" | "invalid_reference" | "invalid_value" | "failed";

export type RepositoryOperation = "read" | "create" | "update" | "remove";

/** What failed: a type of record, or an entry in the audit log. */
export type RepositorySubject = EntityType | "audit_entry";

const DESCRIPTIONS: Readonly<Record<RepositoryErrorKind, string>> = {
  not_found: "there is no such record",
  duplicate: "another record already has this value",
  in_use: "the record is still in use",
  invalid_reference: "a linked record does not exist",
  invalid_value: "a value is not allowed",
  failed: "the database operation failed",
};

export interface RepositoryErrorOptions {
  readonly operation?: RepositoryOperation | undefined;
  /** The name of the database constraint that was broken, if there was one. */
  readonly constraint?: string | undefined;
  readonly cause?: unknown;
}

function messageFor(
  kind: RepositoryErrorKind,
  entityType: RepositorySubject,
  { operation, constraint }: RepositoryErrorOptions,
): string {
  const subject = operation === undefined ? entityType : `could not ${operation} ${entityType}`;
  const detail = constraint === undefined ? "" : ` (${constraint})`;
  return `${subject}: ${DESCRIPTIONS[kind]}${detail}`;
}

/**
 * A failed read or write. The message only ever names the entity type, the
 * kind of failure and the constraint, never the values involved: the driver's
 * own error (kept as `cause`) includes the query parameters, which hold real
 * content.
 */
export class RepositoryError extends Error {
  override readonly name = "RepositoryError";
  readonly kind: RepositoryErrorKind;
  readonly entityType: RepositorySubject;
  readonly constraint: string | undefined;

  constructor(
    kind: RepositoryErrorKind,
    entityType: RepositorySubject,
    options: RepositoryErrorOptions = {},
  ) {
    super(messageFor(kind, entityType, options), { cause: options.cause });
    this.kind = kind;
    this.entityType = entityType;
    this.constraint = options.constraint;
  }
}

interface DriverErrorDetails {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
}

/** The SQLSTATE and constraint from a Postgres error. Drizzle wraps it, so walk the causes. */
function driverErrorDetails(error: unknown): DriverErrorDetails {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (typeof code === "string") {
      return { code, constraint: typeof constraint === "string" ? constraint : undefined };
    }
    current = current.cause;
  }
  return { code: undefined, constraint: undefined };
}

function kindFor(code: string | undefined, operation: RepositoryOperation): RepositoryErrorKind {
  if (code === undefined) return "failed";
  if (code === "23505") return "duplicate";
  // 23001 is ON DELETE RESTRICT. 23503 on a delete means another record links to it.
  if (code === "23001") return "in_use";
  if (code === "23503") return operation === "remove" ? "in_use" : "invalid_reference";
  // Check and not-null violations, and data exceptions (class 22) such as a
  // value too long for its column or an unknown enum value.
  if (code === "23514" || code === "23502" || code.startsWith("22")) return "invalid_value";
  return "failed";
}

/** Turns any error from a database call into a RepositoryError with a safe message. */
export function toRepositoryError(
  error: unknown,
  entityType: RepositorySubject,
  operation: RepositoryOperation,
): RepositoryError {
  if (error instanceof RepositoryError) return error;
  const { code, constraint } = driverErrorDetails(error);
  return new RepositoryError(kindFor(code, operation), entityType, {
    operation,
    constraint,
    cause: error,
  });
}
