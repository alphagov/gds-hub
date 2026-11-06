import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "test/e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL },
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
      DATABASE_URL: "postgres://gdshub:gdshub@localhost:5432/gdshub",
    },
  },
});
