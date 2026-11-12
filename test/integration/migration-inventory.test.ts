import { execFile } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURES_DIR, REPO_ROOT } from "../../src/migration/config.js";

const run = promisify(execFile);

const SCRIPT = "src/migration/scripts/inventory.ts";
const workDir = mkdtempSync(path.join(os.tmpdir(), "gds-hub-migration-inventory-"));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

interface ScriptResult {
  readonly exitCode: number;
  readonly logs: readonly Record<string, unknown>[];
}

/** The environment without any migration settings, so only the arguments count. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("HUB_") && !name.startsWith("MIGRATION_"),
    ),
  );
}

async function inventory(args: readonly string[]): Promise<ScriptResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: cleanEnv(),
    });
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

function parseLogs(output: string): Record<string, unknown>[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function summaries(logs: readonly Record<string, unknown>[]): Record<string, unknown> {
  return Object.fromEntries(
    logs
      .filter((log) => log.msg === "inventory summary")
      .map((log): [string, unknown] => [String(log.group), log.passed]),
  );
}

function reportsIn(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), "utf8")) as unknown);
}

describe("npm run migrate:inventory", () => {
  it(
    "passes on the fixture folders, with a summary for each kind of input and a report",
    { timeout: 60_000 },
    async () => {
      const reportDir = path.join(workDir, "passing-reports");
      const result = await inventory([
        "--data",
        path.join(FIXTURES_DIR, "hub-data"),
        "--build",
        path.join(FIXTURES_DIR, "hub-build"),
        "--report-dir",
        reportDir,
      ]);
      expect(result.exitCode).toBe(0);
      expect(summaries(result.logs)).toEqual({
        content: true,
        yaml: true,
        listing: true,
        redirect: true,
        unknown: true,
      });

      const reports = reportsIn(reportDir);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        kind: "gds-hub-migration-report",
        report: "inventory",
        passed: true,
      });
    },
  );

  it(
    "fails, naming the kind of input, when a fixture refers to a record that doesn't exist",
    { timeout: 60_000 },
    async () => {
      const copy = path.join(workDir, "broken");
      cpSync(FIXTURES_DIR, copy, { recursive: true });
      const teams = path.join(copy, "hub-data/products_teams_and_services.yml");
      writeFileSync(teams, readFileSync(teams, "utf8").replace("- lanternly", "- missing-tool"));

      const result = await inventory([
        "--data",
        path.join(copy, "hub-data"),
        "--build",
        path.join(copy, "hub-build"),
        "--report-dir",
        path.join(workDir, "failing-reports"),
      ]);
      expect(result.exitCode).toBe(1);
      expect(summaries(result.logs)).toEqual({
        content: true,
        yaml: false,
        listing: true,
        redirect: true,
        unknown: true,
      });
    },
  );

  it(
    "fails fast, before reading anything, when a directory is unset",
    { timeout: 60_000 },
    async () => {
      const result = await inventory(["--build", path.join(FIXTURES_DIR, "hub-build")]);
      expect(result.exitCode).toBe(2);
      expect(JSON.stringify(result.logs)).toContain("HUB_DATA_DIR");
      expect(summaries(result.logs)).toEqual({});
    },
  );

  it("fails fast when a directory is inside the repository", { timeout: 60_000 }, async () => {
    const result = await inventory([
      "--data",
      path.join(REPO_ROOT, "src"),
      "--build",
      path.join(FIXTURES_DIR, "hub-build"),
    ]);
    expect(result.exitCode).toBe(2);
    expect(JSON.stringify(result.logs)).toContain("inside this repository");
  });
});
