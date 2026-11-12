import { describe, expect, it } from "vitest";
import { parseMigrationArgs } from "../../../src/migration/cli.js";
import { MigrationConfigError } from "../../../src/migration/config.js";

describe("the migration scripts' command-line options", () => {
  it("are dry runs unless --apply is given", () => {
    expect(parseMigrationArgs(["--data", "a", "--build", "b"], "load").apply).toBe(false);
    expect(parseMigrationArgs(["--data", "a", "--build", "b", "--apply"], "load").apply).toBe(true);
  });

  it("read the database host for the load and verify scripts", () => {
    expect(
      parseMigrationArgs(["--database-host", "hub.cluster.example.com"], "load").databaseHost,
    ).toBe("hub.cluster.example.com");
    expect(
      parseMigrationArgs(["--database-host", "hub.cluster.example.com"], "verify").databaseHost,
    ).toBe("hub.cluster.example.com");
  });

  it("read the shared input options for every script", () => {
    for (const script of ["inventory", "load", "verify"] as const) {
      expect(
        parseMigrationArgs(
          ["--data", "s3://example-bucket/hub-data/", "--build", "/tmp/build", "--report-dir", "r"],
          script,
        ),
      ).toMatchObject({
        data: "s3://example-bucket/hub-data/",
        build: "/tmp/build",
        reportDir: "r",
      });
    }
  });

  it("refuse --apply where it means nothing, so nobody thinks it wrote anything", () => {
    expect(() => parseMigrationArgs(["--apply"], "inventory")).toThrow(MigrationConfigError);
    expect(() => parseMigrationArgs(["--apply"], "verify")).toThrow(MigrationConfigError);
  });

  it("refuse --database-host for the inventory, which never uses the database", () => {
    expect(() => parseMigrationArgs(["--database-host", "db.example.com"], "inventory")).toThrow(
      MigrationConfigError,
    );
  });

  it("refuse options they don't know", () => {
    expect(() => parseMigrationArgs(["--force"], "load")).toThrow(MigrationConfigError);
  });
});
