import { createJsonLogger } from "../../lib/logger.js";
import { runInventory } from "../cli.js";

// npm run migrate:inventory -- --data <folder> --build <folder> [options]
// See docs/migration.md for the options and settings.

const logger = createJsonLogger({ level: "info", base: { script: "migrate:inventory" } });

try {
  process.exitCode = await runInventory(process.argv.slice(2), process.env, logger);
} catch (error) {
  logger.error("migrate:inventory failed", { err: error });
  process.exitCode = 1;
}
