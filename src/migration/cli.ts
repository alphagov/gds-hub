import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { ConfigError, loadConfig, type Config } from "../config.js";
import type { Logger } from "../lib/logger.js";
import { connectRepositories } from "../repositories/index.js";
import {
  MigrationConfigError,
  loadMigrationOptions,
  type MigrationArgs,
  type MigrationOptions,
} from "./config.js";
import { MigrationTargetError, assertMigrationDatabase } from "./database-target.js";
import { buildMigrationPlan, type MigrationPlan } from "./inventory.js";
import { createLoadReport, newRunId } from "./load-report.js";
import { MigrationLoadError, loadPlan } from "./loader.js";
import { createInventoryReport, writeReport } from "./report.js";
import { createAwsS3Access } from "./storage/aws-s3.js";
import { openStorage, type MigrationStorage, type S3Access } from "./storage/index.js";
import { createVerifyReport, verifyMigration } from "./verify.js";

/**
 * The migration's command-line scripts: inventory, load and verify. Each
 * reads the same inputs, from local folders or S3, so the same command runs
 * on a laptop and as a one-off task in AWS. Logs hold paths, keys, counts and
 * warnings, never content.
 */

/** Exit codes for the migration scripts. */
export const EXIT_CODES = { passed: 0, failed: 1, invalidSettings: 2 } as const;

export type MigrationScript = "inventory" | "load" | "verify";

const SHARED_OPTIONS = {
  data: { type: "string" },
  build: { type: "string" },
  "content-selector": { type: "string" },
  strip: { type: "string" },
  "site-origin": { type: "string" },
  "asset-base-path": { type: "string" },
  "report-dir": { type: "string" },
} as const;

const OPTIONS = {
  inventory: SHARED_OPTIONS,
  load: {
    ...SHARED_OPTIONS,
    apply: { type: "boolean" },
    "database-host": { type: "string" },
  },
  verify: { ...SHARED_OPTIONS, "database-host": { type: "string" } },
} as const;

export interface MigrationCommandArgs extends MigrationArgs {
  /** Keep the load's writes. Only the load script takes it. */
  readonly apply: boolean;
}

/**
 * Reads a script's command-line options. Throws MigrationConfigError for
 * anything unknown, including an option the script doesn't take, such as
 * --apply for verify.
 */
export function parseMigrationArgs(
  argv: readonly string[],
  script: MigrationScript,
): MigrationCommandArgs {
  let values: Readonly<Record<string, unknown>>;
  try {
    const options: ParseArgsOptionsConfig = OPTIONS[script];
    values = parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    throw new MigrationConfigError([
      error instanceof Error ? error.message : "the command-line options couldn't be read",
    ]);
  }
  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === "string" ? value : undefined;
  };
  return {
    data: text("data"),
    build: text("build"),
    contentSelector: text("content-selector"),
    strip: text("strip"),
    siteOrigin: text("site-origin"),
    assetBasePath: text("asset-base-path"),
    reportDir: text("report-dir"),
    databaseHost: text("database-host"),
    apply: values.apply === true,
  };
}

export interface CliDependencies {
  /** Makes the S3 client, only if an input or the report location is in S3. */
  readonly s3?: () => S3Access;
}

interface Prepared {
  readonly args: MigrationCommandArgs;
  readonly options: MigrationOptions;
  readonly storage: MigrationStorage;
}

/** Reads the options and opens the storage, or logs why it can't. */
function prepare(
  script: MigrationScript,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  logger: Logger,
  dependencies: CliDependencies,
): Prepared | undefined {
  try {
    const args = parseMigrationArgs(argv, script);
    const options = loadMigrationOptions(args, env);
    const storage = openStorage(options, dependencies.s3 ?? createAwsS3Access);
    return { args, options, storage };
  } catch (error) {
    if (error instanceof MigrationConfigError) {
      logger.error("invalid migration settings", { issues: error.issues });
      return undefined;
    }
    throw error;
  }
}

/** The app config and the database check for the scripts that use the database. */
function databaseConfig(
  env: NodeJS.ProcessEnv,
  options: MigrationOptions,
  logger: Logger,
): Config | undefined {
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error("invalid configuration", { issues: error.issues });
      return undefined;
    }
    throw error;
  }
  try {
    assertMigrationDatabase(config, options.databaseHost);
  } catch (error) {
    if (error instanceof MigrationTargetError) {
      logger.error("refusing to use this database", { issues: [error.message] });
      return undefined;
    }
    throw error;
  }
  return config;
}

/** Builds the plan, logging its validation issues. Undefined if it has any. */
async function passingPlan(prepared: Prepared, logger: Logger): Promise<MigrationPlan | undefined> {
  const { sources } = prepared.storage;
  logger.info("taking an inventory", {
    data: sources.data.label,
    build: sources.build.label,
    contentSelector: prepared.options.contentSelector,
  });
  const plan = await buildMigrationPlan(sources, prepared.options);
  for (const issue of plan.issues) logger.warn("validation issue", { ...issue });
  if (plan.issues.length > 0) {
    logger.error(
      "the inventory failed, so nothing was done. Run migrate:inventory for the report",
      {
        issues: plan.issues.length,
      },
    );
    return undefined;
  }
  return plan;
}

/**
 * Takes an inventory of the data and build folders, writes the report and
 * logs a pass or fail summary for each kind of input. Returns the exit code.
 */
export async function runInventory(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  logger: Logger,
  dependencies: CliDependencies = {},
): Promise<number> {
  const prepared = prepare("inventory", argv, env, logger, dependencies);
  if (prepared === undefined) return EXIT_CODES.invalidSettings;
  const { options, storage } = prepared;

  logger.info("taking an inventory", {
    data: storage.sources.data.label,
    build: storage.sources.build.label,
    contentSelector: options.contentSelector,
    stripSelectors: options.stripSelectors,
    siteOrigins: options.siteOrigins,
  });
  const plan = await buildMigrationPlan(storage.sources, options);
  const report = createInventoryReport(plan, new Date());
  const file = await writeReport(storage.reports, report);

  for (const issue of plan.issues) logger.warn("validation issue", { ...issue });
  for (const row of report.summary) logger.info("inventory summary", { ...row });
  logger.info(report.passed ? "inventory passed" : "inventory failed", {
    report: file,
    recordCounts: report.recordCounts,
  });
  return report.passed ? EXIT_CODES.passed : EXIT_CODES.failed;
}

/**
 * Loads the inputs into the database: a dry run unless --apply is given.
 * Exits 0 when done, 1 if it was refused or had to skip records, and 2 for
 * invalid settings or a database it mustn't use.
 */
export async function runLoad(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  logger: Logger,
  dependencies: CliDependencies = {},
): Promise<number> {
  const prepared = prepare("load", argv, env, logger, dependencies);
  if (prepared === undefined) return EXIT_CODES.invalidSettings;
  const config = databaseConfig(env, prepared.options, logger);
  if (config === undefined) return EXIT_CODES.invalidSettings;

  const plan = await passingPlan(prepared, logger);
  if (plan === undefined) return EXIT_CODES.failed;

  const { apply } = prepared.args;
  const runId = newRunId(new Date());
  logger.info(apply ? "loading" : "dry run: working out what loading would do", { runId });

  const database = connectRepositories(config.databaseUrl);
  try {
    const outcome = await loadPlan(plan, database.repositories, { apply, runId });
    const report = createLoadReport(outcome, new Date());
    const file = await writeReport(prepared.storage.reports, report);

    for (const row of report.summary) logger.info("load summary", { ...row });
    for (const link of report.links) logger.info("link summary", { ...link });
    for (const skipped of report.skipped) logger.warn("skipped", { ...skipped });
    if (report.onlyInDatabase.length > 0) {
      logger.warn("records in the database but not in the current Hub, which were left alone", {
        records: report.onlyInDatabase.length,
      });
    }
    logger.info(apply ? "applied" : "dry run: nothing was written", { runId, report: file });
    return report.passed ? EXIT_CODES.passed : EXIT_CODES.failed;
  } catch (error) {
    if (error instanceof MigrationLoadError) {
      logger.error("the load was refused, and nothing was written", {
        reason: error.reason,
        issues: [error.message],
      });
      return EXIT_CODES.failed;
    }
    throw error;
  } finally {
    await database.close();
  }
}

/**
 * Checks a loaded migration against the inputs, and the new pages against the
 * old ones. Writes nothing but its report. Exits 0 if there are no problems.
 */
export async function runVerify(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  logger: Logger,
  dependencies: CliDependencies = {},
): Promise<number> {
  const prepared = prepare("verify", argv, env, logger, dependencies);
  if (prepared === undefined) return EXIT_CODES.invalidSettings;
  const config = databaseConfig(env, prepared.options, logger);
  if (config === undefined) return EXIT_CODES.invalidSettings;

  const plan = await passingPlan(prepared, logger);
  if (plan === undefined) return EXIT_CODES.failed;

  const database = connectRepositories(config.databaseUrl);
  try {
    const outcome = await verifyMigration({
      plan,
      sources: prepared.storage.sources,
      contentSelector: prepared.options.contentSelector,
      repositories: database.repositories,
      config,
      // The app's request logs are tagged, to tell them apart from the summary.
      logger: logger.child({ component: "verify-app" }),
    });
    const report = createVerifyReport(outcome, new Date());
    const file = await writeReport(prepared.storage.reports, report);

    for (const problem of outcome.problems) logger.warn("problem", { ...problem });
    for (const warning of outcome.warnings) logger.info("needs a person to check", { ...warning });
    logger.info(outcome.passed ? "verify passed" : "verify failed", {
      report: file,
      checked: outcome.checked,
      problems: outcome.problems.length,
      warnings: outcome.warnings.length,
      waitingForPhase6: outcome.waitingForPhase6.length,
    });
    return outcome.passed ? EXIT_CODES.passed : EXIT_CODES.failed;
  } finally {
    await database.close();
  }
}
