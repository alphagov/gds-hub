import { describe, expect, it } from "vitest";
import {
  MigrationTargetError,
  assertMigrationDatabase,
} from "../../../src/migration/database-target.js";

const LOCAL = "postgres://gdshub:gdshub@localhost:5432/gdshub_migration";
const REMOTE = "postgres://hub:example@hub.cluster-example.eu-west-2.rds.amazonaws.com:5432/hub";
const REMOTE_HOST = "hub.cluster-example.eu-west-2.rds.amazonaws.com";

function refusal(
  nodeEnv: "development" | "test" | "production",
  databaseUrl: string,
  databaseHost?: string,
): string {
  try {
    assertMigrationDatabase({ nodeEnv, databaseUrl }, databaseHost);
  } catch (error) {
    if (error instanceof MigrationTargetError) return error.message;
    throw error;
  }
  throw new Error("expected the database to be refused");
}

describe("the database the migration writes to", () => {
  it("can be a local database without saying so", () => {
    expect(() => {
      assertMigrationDatabase({ nodeEnv: "development", databaseUrl: LOCAL }, undefined);
    }).not.toThrow();
  });

  it("can't be a database on another host unless that host is named", () => {
    const message = refusal("development", REMOTE);
    expect(message).toContain("--database-host");
  });

  it("can be a database on another host when that exact host is named", () => {
    expect(() => {
      assertMigrationDatabase({ nodeEnv: "production", databaseUrl: REMOTE }, REMOTE_HOST);
    }).not.toThrow();
  });

  it("ignores letter case when comparing host names", () => {
    expect(() => {
      assertMigrationDatabase(
        { nodeEnv: "production", databaseUrl: REMOTE },
        REMOTE_HOST.toUpperCase(),
      );
    }).not.toThrow();
  });

  it("can't be a different host from the one named", () => {
    const message = refusal(
      "production",
      REMOTE,
      "other.cluster-example.eu-west-2.rds.amazonaws.com",
    );
    expect(message).toContain("doesn't match");
  });

  it("can't be named in a way that moves the connection somewhere else", () => {
    refusal("production", `${REMOTE}?host=elsewhere.example.com`, REMOTE_HOST);
    refusal("development", `${LOCAL}?hostaddr=192.0.2.10`);
  });

  it("can't be a local database while NODE_ENV is production, unless it is named", () => {
    refusal("production", LOCAL);
    expect(() => {
      assertMigrationDatabase({ nodeEnv: "production", databaseUrl: LOCAL }, "localhost");
    }).not.toThrow();
  });

  it("is refused without repeating the password from DATABASE_URL", () => {
    expect(refusal("development", REMOTE)).not.toContain("example@");
    expect(refusal("production", REMOTE, "other.example.com")).not.toContain(":example");
  });
});
