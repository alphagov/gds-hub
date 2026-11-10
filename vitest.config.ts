import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Vitest doesn't read .env, so pass DATABASE_URL through from it, matching the
// db:* scripts. A value already in the environment (as in CI) wins.
function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!existsSync(".env")) return undefined;
  return parseEnv(readFileSync(".env", "utf8")).DATABASE_URL;
}

const url = databaseUrl();

export default defineConfig({
  test: {
    // Integration tests need Postgres at DATABASE_URL (docker compose up -d db
    // locally, the db service in CI). Each test file creates its own database.
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    environment: "node",
    hookTimeout: 60_000,
    env: url ? { DATABASE_URL: url } : {},
  },
});
