import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config.js";

const validEnv = { DATABASE_URL: "postgres://user:pass@localhost:5432/hub" };

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

describe("loadConfig", () => {
  it("applies defaults when only required values are set", () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: "development",
      port: 3000,
      logLevel: "info",
      version: "dev",
      databaseUrl: validEnv.DATABASE_URL,
    });
  });

  it("reads and coerces values from the environment", () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "production",
      PORT: "8080",
      LOG_LEVEL: "warn",
      APP_VERSION: "abc123",
    });
    expect(config).toMatchObject({
      nodeEnv: "production",
      port: 8080,
      logLevel: "warn",
      version: "abc123",
    });
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(loadConfig(validEnv))).toBe(true);
  });

  it("fails when a required value is missing", () => {
    const error = captureError(() => loadConfig({}));
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.join("\n")).toMatch(/DATABASE_URL/);
  });

  it("treats an empty string as missing", () => {
    expect(() => loadConfig({ DATABASE_URL: "" })).toThrow(ConfigError);
  });

  it("lists every invalid value at once", () => {
    const error = captureError(() =>
      loadConfig({
        DATABASE_URL: "mysql://localhost/hub",
        PORT: "not-a-port",
        LOG_LEVEL: "loud",
      }),
    ) as ConfigError;
    const fields = error.issues.map((issue) => issue.split(":")[0]);
    expect(fields).toEqual(expect.arrayContaining(["DATABASE_URL", "PORT", "LOG_LEVEL"]));
  });
});
