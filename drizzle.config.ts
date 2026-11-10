import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema, so it doesn't need a database.
// The app applies migrations itself with `npm run db:migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
