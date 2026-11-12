import { parseArgs } from "node:util";
import type { Logger } from "../lib/logger.js";
import {
  MigrationConfigError,
  loadMigrationOptions,
  type MigrationArgs,
  type MigrationOptions,
} from "./config.js";
import { buildMigrationPlan } from "./inventory.js";
import { createInventoryReport, writeReport } from "./report.js";

/** Exit codes for the migration scripts. */
export const EXIT_CODES = { passed: 0, failed: 1, invalidSettings: 2 } as const;

const OPTIONS = {
  data: { type: "string" },
  build: { type: "string" },
  "content-selector": { type: "string" },
  strip: { type: "string" },
  "site-origin": { type: "string" },
  "asset-base-path": { type: "string" },
  "report-dir": { type: "string" },
} as const;

const parseOptions = (argv: readonly string[]) =>
  parseArgs({ args: [...argv], options: OPTIONS, strict: true, allowPositionals: false }).values;

/** Reads the shared command-line options. Throws MigrationConfigError for anything unknown. */
export function parseMigrationArgs(argv: readonly string[]): MigrationArgs {
  let values: ReturnType<typeof parseOptions>;
  try {
    values = parseOptions(argv);
  } catch (error) {
    throw new MigrationConfigError([
      error instanceof Error ? error.message : "the command-line options couldn't be read",
    ]);
  }
  return {
    data: values.data,
    build: values.build,
    contentSelector: values["content-selector"],
    strip: values.strip,
    siteOrigin: values["site-origin"],
    assetBasePath: values["asset-base-path"],
    reportDir: values["report-dir"],
  };
}

/**
 * Takes an inventory of the data and build folders, writes the report and
 * logs a pass or fail summary for each kind of input. Returns the exit code.
 * Logs hold paths, keys, counts and warnings, never content.
 */
export async function runInventory(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Promise<number> {
  let options: MigrationOptions;
  try {
    options = loadMigrationOptions(parseMigrationArgs(argv), env);
  } catch (error) {
    if (error instanceof MigrationConfigError) {
      logger.error("invalid migration settings", { issues: error.issues });
      return EXIT_CODES.invalidSettings;
    }
    throw error;
  }

  logger.info("taking an inventory", {
    contentSelector: options.contentSelector,
    stripSelectors: options.stripSelectors,
    siteOrigins: options.siteOrigins,
  });
  const plan = await buildMigrationPlan(options);
  const report = createInventoryReport(plan, new Date());
  const file = await writeReport(options.reportDir, report);

  for (const issue of plan.issues) logger.warn("validation issue", { ...issue });
  for (const row of report.summary) logger.info("inventory summary", { ...row });
  logger.info(report.passed ? "inventory passed" : "inventory failed", {
    report: file,
    recordCounts: report.recordCounts,
  });
  return report.passed ? EXIT_CODES.passed : EXIT_CODES.failed;
}
