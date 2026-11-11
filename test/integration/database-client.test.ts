import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type DatabaseConnection } from "../../src/db/client.js";
import { createTestDatabase, postgresErrorCode, type TestDatabase } from "./test-database.js";

// Postgres raises query_canceled when statement_timeout stops a statement.
const QUERY_CANCELED = "57014";

let testDatabase: TestDatabase | undefined;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase?.drop();
});

function databaseUrl(): string {
  if (testDatabase === undefined) throw new Error("the test database was not created");
  return testDatabase.url;
}

async function withConnection(
  options: Parameters<typeof connect>[1],
  work: (connection: DatabaseConnection) => Promise<void>,
): Promise<void> {
  const connection = connect(databaseUrl(), options);
  try {
    await work(connection);
  } finally {
    await connection.close();
  }
}

describe("the database client", () => {
  it("cancels a statement that runs longer than the statement timeout", async () => {
    await withConnection({ statementTimeoutMs: 100 }, async ({ db }) => {
      const code = await postgresErrorCode(() => db.execute(sql`SELECT pg_sleep(2)`));

      expect(code).toBe(QUERY_CANCELED);
    });
  });

  it("runs statements without a limit when no timeout is set", async () => {
    await withConnection({}, async ({ db }) => {
      const result = await db.execute(sql`SELECT pg_sleep(0.2), 1 AS ok`);

      expect(result.rows[0]).toMatchObject({ ok: 1 });
    });
  });
});
