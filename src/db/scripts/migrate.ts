import { runMigrations } from "../migrate.js";
import { runScript } from "./run-script.js";

await runScript("db:migrate", async ({ db, logger }) => {
  logger.info("applying migrations");
  await runMigrations(db);
  logger.info("migrations applied");
});
