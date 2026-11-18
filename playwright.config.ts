import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

// The e2e server's database, found the same way as vitest.config.ts and the
// db:* scripts: the environment first (as in CI), then .env, so a local
// database on a different port (DB_HOST_PORT) is the one the tests use.
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env")) {
    const fromFile = parseEnv(readFileSync(".env", "utf8")).DATABASE_URL;
    if (fromFile) return fromFile;
  }
  return "postgres://gdshub:gdshub@localhost:5432/gdshub";
}

const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "test/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL },
  // Tests run twice: once as normal and once with JavaScript turned off,
  // because every page must work without JavaScript. axe needs JavaScript to
  // run, so the accessibility spec scans the no-JavaScript version of each
  // page itself (by blocking the page's scripts) and only runs in "chromium".
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium-no-js",
      use: { ...devices["Desktop Chrome"], javaScriptEnabled: false },
      testIgnore: "accessibility.spec.ts",
    },
  ],
  webServer: {
    command: "npm run build && npm start",
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NODE_ENV: "test",
      PORT: String(PORT),
      LOG_LEVEL: "warn",
      APP_VERSION: "e2e",
      DATABASE_URL: databaseUrl(),
    },
  },
});
