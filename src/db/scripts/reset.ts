import { runMigrations } from "../migrate.js";
import { assertLocalDatabase, dropAppObjects } from "../reset.js";
import { seedDatabase } from "../seed/seed.js";
import { runScript } from "./run-script.js";

await runScript("db:reset", async ({ config, db, logger }) => {
  assertLocalDatabase(config);
  logger.info(
    "checking the database, then dropping the app's tables, views, functions, enums and migration history",
  );
  await dropAppObjects(db);
  logger.info("applying migrations");
  await runMigrations(db);
  logger.info("seeding synthetic data");
  await seedDatabase(db);
  logger.info("reset complete");
});
