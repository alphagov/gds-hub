import { createJsonLogger } from "../../lib/logger.js";
import { runVerify } from "../cli.js";

// npm run migrate:verify -- --data <folder or s3://...> --build <folder or s3://...> [options]
// Writes nothing but its report. See docs/migration.md for the options and settings.

const logger = createJsonLogger({ level: "info", base: { script: "migrate:verify" } });

try {
  process.exitCode = await runVerify(process.argv.slice(2), process.env, logger);
} catch (error) {
  logger.error("migrate:verify failed", { err: error });
  process.exitCode = 1;
}
