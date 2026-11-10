import { runMigrations } from "../migrate.js";
import { assertLocalDatabase, assertResettable, dropEverything } from "../reset.js";
import { seedDatabase } from "../seed/seed.js";
import { runScript } from "./run-script.js";

await runScript("db:reset", async ({ config, db, logger }) => {
  assertLocalDatabase(config);
  await assertResettable(db);
  logger.info("dropping all tables, views, enums and migration history");
  await dropEverything(db);
  logger.info("applying migrations");
  await runMigrations(db);
  logger.info("seeding synthetic data");
  await seedDatabase(db);
  logger.info("reset complete");
});
