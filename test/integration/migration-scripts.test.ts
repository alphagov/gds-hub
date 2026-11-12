import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tools } from "../../src/db/schema/index.js";
import { FIXTURES_DIR, REPO_ROOT } from "../../src/migration/config.js";
import { FIXTURE_SITE_ORIGIN } from "../unit/migration/helpers.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

const run = promisify(execFile);

const workDir = mkdtempSync(path.join(os.tmpdir(), "gds-hub-migration-scripts-"));
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createMigratedTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
  rmSync(workDir, { recursive: true, force: true });
});

interface ScriptResult {
  readonly exitCode: number;
  readonly logs: readonly Record<string, unknown>[];
}

function parseLogs(output: string): Record<string, unknown>[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The environment without migration settings, pointed at a database. */
function envFor(databaseUrl: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !name.startsWith("HUB_") && !name.startsWith("MIGRATION_"),
      ),
    ),
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    DATABASE_URL: databaseUrl,
  };
}

async function script(
  file: string,
  args: readonly string[],
  databaseUrl: string = testDb.url,
): Promise<ScriptResult> {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "tsx", `src/migration/scripts/${file}`, ...args],
      { cwd: REPO_ROOT, env: envFor(databaseUrl) },
    );
    return { exitCode: 0, logs: parseLogs(stdout + stderr) };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof failed.code !== "number") throw error;
    return {
      exitCode: failed.code,
      logs: parseLogs((failed.stdout ?? "") + (failed.stderr ?? "")),
    };
  }
}

function fixtureArgs(reportDir: string): string[] {
  return [
    "--data",
    path.join(FIXTURES_DIR, "hub-data"),
    "--build",
    path.join(FIXTURES_DIR, "hub-build"),
    "--site-origin",
    FIXTURE_SITE_ORIGIN,
    "--report-dir",
    reportDir,
  ];
}

function reportsIn(dir: string): Record<string, unknown>[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map(
      (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Record<string, unknown>,
    );
}

describe("npm run migrate:load and migrate:verify", () => {
  it(
    "does a dry run by default, writing a report and nothing else",
    { timeout: 60_000 },
    async () => {
      const reportDir = path.join(workDir, "dry-run");
      const result = await script("load.ts", fixtureArgs(reportDir));

      expect(result.exitCode).toBe(0);
      expect(await testDb.db.$count(tools)).toBe(0);
      const [report] = reportsIn(reportDir);
      expect(report).toMatchObject({
        kind: "gds-hub-migration-report",
        report: "load",
        applied: false,
        passed: true,
      });
      expect(result.logs.some((log) => log.msg === "dry run: nothing was written")).toBe(true);
    },
  );

  it("loads the fixtures with --apply", { timeout: 60_000 }, async () => {
    const reportDir = path.join(workDir, "apply");
    const result = await script("load.ts", [...fixtureArgs(reportDir), "--apply"]);

    expect(result.exitCode).toBe(0);
    expect(await testDb.db.$count(tools)).toBe(3);
    const [report] = reportsIn(reportDir);
    expect(report).toMatchObject({ report: "load", applied: true, passed: true });
    expect(typeof report?.runId).toBe("string");
  });

  it("verifies the loaded fixtures, writing a report", { timeout: 60_000 }, async () => {
    const reportDir = path.join(workDir, "verify");
    const result = await script("verify.ts", fixtureArgs(reportDir));

    expect(result.exitCode).toBe(0);
    const [report] = reportsIn(reportDir);
    expect(report).toMatchObject({
      kind: "gds-hub-migration-report",
      report: "verify",
      passed: true,
    });
  });

  it(
    "refuses a database on another host unless that host is named, before connecting",
    { timeout: 60_000 },
    async () => {
      const reportDir = path.join(workDir, "remote");
      const result = await script(
        "load.ts",
        [...fixtureArgs(reportDir), "--apply"],
        "postgres://hub:not-a-real-password@hub-db.invalid:5432/hub",
      );

      expect(result.exitCode).toBe(2);
      const output = JSON.stringify(result.logs);
      expect(output).toContain("--database-host");
      expect(output).not.toContain("not-a-real-password");
    },
  );

  it("refuses settings that aren't valid", { timeout: 60_000 }, async () => {
    const result = await script("load.ts", ["--data", "s3://Not_A_Bucket/", "--build", "/tmp"]);
    expect(result.exitCode).toBe(2);
  });
});
