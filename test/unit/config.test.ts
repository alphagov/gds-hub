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

  describe("database settings as parts", () => {
    const parts = {
      DATABASE_HOST: "hub.example.eu-west-2.rds.amazonaws.com",
      DATABASE_NAME: "hub",
      DATABASE_USER: "app",
      DATABASE_PASSWORD: "p@ss/w:rd?#",
    };

    it("builds a URL that verifies the server certificate", () => {
      const { databaseUrl } = loadConfig(parts);
      expect(databaseUrl).toBe(
        "postgres://app:p%40ss%2Fw%3Ard%3F%23@hub.example.eu-west-2.rds.amazonaws.com:5432/hub?sslmode=verify-full",
      );
      expect(new URL(databaseUrl).password).toBe("p%40ss%2Fw%3Ard%3F%23");
    });

    it("uses DATABASE_PORT when it is set", () => {
      expect(loadConfig({ ...parts, DATABASE_PORT: "6543" }).databaseUrl).toContain(":6543/hub");
    });

    it("leaves DATABASE_URL as it was given", () => {
      expect(loadConfig(validEnv).databaseUrl).toBe(validEnv.DATABASE_URL);
    });

    it("names the missing parts", () => {
      const error = captureError(() =>
        loadConfig({ DATABASE_HOST: parts.DATABASE_HOST, DATABASE_USER: "app" }),
      ) as ConfigError;
      expect(error.issues).toEqual([
        "DATABASE_NAME: required when the database is set as parts",
        "DATABASE_PASSWORD: required when the database is set as parts",
      ]);
    });

    it("rejects DATABASE_URL together with parts", () => {
      expect(() => loadConfig({ ...validEnv, ...parts })).toThrow(ConfigError);
    });

    it("rejects a host name that is not a host name", () => {
      expect(() => loadConfig({ ...parts, DATABASE_HOST: "evil.example/path?x=" })).toThrow(
        ConfigError,
      );
    });

    it("never puts the password in an error", () => {
      const error = captureError(() =>
        loadConfig({ ...parts, DATABASE_PORT: "not-a-port" }),
      ) as ConfigError;
      expect(error.message).not.toContain(parts.DATABASE_PASSWORD);
      expect(error.message).not.toContain("p%40ss");
    });
  });
});
