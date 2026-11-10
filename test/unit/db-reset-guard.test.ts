import { describe, expect, it } from "vitest";
import { assertLocalDatabase, UnsafeDatabaseOperationError } from "../../src/db/reset.js";

const LOCAL_URL = "postgres://gdshub:gdshub@localhost:5432/gdshub";

describe("assertLocalDatabase", () => {
  it.each([
    "postgres://gdshub:gdshub@localhost:5432/gdshub",
    "postgres://gdshub:gdshub@127.0.0.1:5432/gdshub",
    "postgres://gdshub:gdshub@[::1]:5432/gdshub",
    "postgres://gdshub:gdshub@db:5432/gdshub",
  ])("allows a local database at %s", (databaseUrl) => {
    expect(() => {
      assertLocalDatabase({ nodeEnv: "development", databaseUrl });
    }).not.toThrow();
  });

  it("refuses when NODE_ENV is production, even for a local host", () => {
    expect(() => {
      assertLocalDatabase({ nodeEnv: "production", databaseUrl: LOCAL_URL });
    }).toThrow(UnsafeDatabaseOperationError);
  });

  it.each(["host", "hostaddr"])(
    "refuses a DATABASE_URL with a %s query parameter, which could point somewhere else",
    (param) => {
      expect(() => {
        assertLocalDatabase({
          nodeEnv: "development",
          databaseUrl: `${LOCAL_URL}?${param}=hub.cluster-example.eu-west-2.rds.amazonaws.com`,
        });
      }).toThrow(/query parameter/);
    },
  );

  it("refuses a database on a remote host", () => {
    expect(() => {
      assertLocalDatabase({
        nodeEnv: "development",
        databaseUrl: "postgres://app@hub.cluster-example.eu-west-2.rds.amazonaws.com:5432/hub",
      });
    }).toThrow(/non-local database host/);
  });
});
