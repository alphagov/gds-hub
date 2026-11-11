import { assertLocalDatabase } from "../reset.js";
import { seedDatabase } from "../seed/seed.js";
import { runScript } from "./run-script.js";

await runScript("db:seed", async ({ config, db, logger }) => {
  assertLocalDatabase(config);
  logger.info("seeding synthetic data");
  await seedDatabase(db);
  logger.info("seed complete");
});
