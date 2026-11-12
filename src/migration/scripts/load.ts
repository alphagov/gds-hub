import { createJsonLogger } from "../../lib/logger.js";
import { runLoad } from "../cli.js";

// npm run migrate:load -- --data <folder or s3://...> --build <folder or s3://...> [--apply] [options]
// A dry run unless --apply is given. See docs/migration.md for the options and settings.

const logger = createJsonLogger({ level: "info", base: { script: "migrate:load" } });

try {
  process.exitCode = await runLoad(process.argv.slice(2), process.env, logger);
} catch (error) {
  logger.error("migrate:load failed", { err: error });
  process.exitCode = 1;
}
