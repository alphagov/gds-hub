import { describe, expect, it } from "vitest";
import { tools } from "../../src/db/schema/index.js";
import { RepositoryError, toRepositoryError } from "../../src/repositories/errors.js";
import { createRepository } from "../../src/repositories/repository.js";

const WRITTEN_VALUE = "Confidential written value";

/** An error shaped like Drizzle's: the message holds the query and its parameters. */
function queryError(code: string, constraint?: string): Error {
  const driverError = Object.assign(new Error("database rejected the query"), {
    code,
    constraint,
  });
  return new Error(`Failed query: insert into "vendors" ... params: ${WRITTEN_VALUE}`, {
    cause: driverError,
  });
}

describe("toRepositoryError", () => {
  it("reports a unique violation as a duplicate, naming the constraint", () => {
    const error = toRepositoryError(queryError("23505", "vendors_slug_unique"), "vendor", "create");
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toMatchObject({
      kind: "duplicate",
      entityType: "vendor",
      constraint: "vendors_slug_unique",
    });
  });

  it("reports a restrict violation as the record being in use", () => {
    expect(toRepositoryError(queryError("23001"), "vendor", "remove").kind).toBe("in_use");
  });

  it("reports a foreign key violation on removal as the record being in use", () => {
    expect(toRepositoryError(queryError("23503"), "vendor", "remove").kind).toBe("in_use");
  });

  it("reports a foreign key violation on create or update as an invalid reference", () => {
    expect(toRepositoryError(queryError("23503"), "tool", "create").kind).toBe("invalid_reference");
    expect(toRepositoryError(queryError("23503"), "tool", "update").kind).toBe("invalid_reference");
  });

  it("reports a check or not-null violation as an invalid value", () => {
    expect(
      toRepositoryError(queryError("23514", "vendors_slug_format"), "vendor", "create"),
    ).toMatchObject({ kind: "invalid_value", constraint: "vendors_slug_format" });
    expect(toRepositoryError(queryError("23502"), "vendor", "create").kind).toBe("invalid_value");
  });

  it("reports any other error as a general failure", () => {
    expect(toRepositoryError(new Error("connection lost"), "vendor", "read").kind).toBe("failed");
    expect(toRepositoryError("not an error", "vendor", "read").kind).toBe("failed");
  });

  it("never includes the original message, which can hold the values written", () => {
    const error = toRepositoryError(queryError("23505", "vendors_name_unique"), "vendor", "create");
    expect(error.message).not.toContain(WRITTEN_VALUE);
    expect(error.message).not.toContain("Failed query");
  });

  it("keeps the original error as the cause", () => {
    const original = queryError("23505");
    expect(toRepositoryError(original, "vendor", "create").cause).toBe(original);
  });

  it("passes a repository error through unchanged", () => {
    const original = new RepositoryError("not_found", "vendor");
    expect(toRepositoryError(original, "vendor", "update")).toBe(original);
  });
});

describe("createRepository", () => {
  it("refuses an entity type that does not match the table", () => {
    expect(() => createRepository(tools, "vendor" as never)).toThrow(/does not match/);
  });

  it("accepts the table's own entity type", () => {
    expect(() => createRepository(tools, "tool")).not.toThrow();
  });
});
