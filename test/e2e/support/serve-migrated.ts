// Starts the built app against a database loaded from the synthetic migration
// fixtures, for migrated-content.spec.ts. Run by Playwright's webServer, after
// `npm run build`:
//
//   node --import tsx test/e2e/support/serve-migrated.ts
//
// It drops and recreates a database called gdshub_e2e_migrated on the
// DATABASE_URL server (local servers only, as for db:reset), migrates it and
// loads test/fixtures/migration into it. The loader refuses a seeded database,
// which is why this isn't the database the other tests use.

import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { connect } from "../../../src/db/client.js";
import { runMigrations } from "../../../src/db/migrate.js";
import { assertLocalDatabase } from "../../../src/db/local-database.js";
import { createJsonLogger } from "../../../src/lib/logger.js";
import { runLoad } from "../../../src/migration/cli.js";

const DATABASE_NAME = "gdshub_e2e_migrated";
const FIXTURES = path.join(import.meta.dirname, "..", "..", "fixtures", "migration");

const serverUrl = process.env.DATABASE_URL;
if (!serverUrl) throw new Error("DATABASE_URL is not set");
assertLocalDatabase({ nodeEnv: "test", databaseUrl: serverUrl });

const url = new URL(serverUrl);
url.pathname = `/${DATABASE_NAME}`;
const databaseUrl = url.toString();

const admin = new pg.Client({ connectionString: serverUrl });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${DATABASE_NAME}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${DATABASE_NAME}"`);
} finally {
  await admin.end();
}

const connection = connect(databaseUrl);
try {
  await runMigrations(connection.db);
} finally {
  await connection.close();
}

const logger = createJsonLogger({ level: "warn", base: { script: "serve-migrated" } });
const exitCode = await runLoad(
  [
    "--apply",
    "--data",
    path.join(FIXTURES, "hub-data"),
    "--build",
    path.join(FIXTURES, "hub-build"),
    "--site-origin",
    "https://hub.example.com",
    "--content-selector",
    "main",
  ],
  { ...process.env, DATABASE_URL: databaseUrl },
  logger,
);
if (exitCode !== 0) throw new Error(`loading the fixtures failed (exit code ${exitCode})`);

process.env.DATABASE_URL = databaseUrl;
// The built server starts listening when it is imported. The path is in a
// variable because TypeScript has no declarations for build output.
const SERVER_ENTRY = "../../../dist/server.js";
if (!existsSync(path.join(import.meta.dirname, SERVER_ENTRY))) {
  throw new Error("dist/server.js doesn't exist: run npm run build first");
}
await import(SERVER_ENTRY);
