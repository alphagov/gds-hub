import { resolve } from "node:path";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

// Runs the project's own no-restricted-imports setting for a file path against
// a sample import, so the test follows any change to eslint.config.js.

const eslint = new ESLint();

async function restrictedImportMessages(filePath: string, code: string): Promise<string[]> {
  const absolutePath = resolve(filePath);
  const config: { rules?: Record<string, Linter.RuleEntry> } | undefined =
    await eslint.calculateConfigForFile(absolutePath);
  const rule = config?.rules?.["no-restricted-imports"];
  if (rule === undefined) return [];

  const linter = new Linter();
  return linter
    .verify(
      code,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tseslint.parser },
          rules: { "no-restricted-imports": rule },
        },
      ],
      absolutePath,
    )
    .map((message) => message.message);
}

describe("access to the database layer", () => {
  it("is refused to a route that imports the database client", async () => {
    const messages = await restrictedImportMessages(
      "src/routes/example.ts",
      'import { connect } from "../db/client.js";\n',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("repositor");
  });

  it("is refused to a type-only import of the database layer", async () => {
    const messages = await restrictedImportMessages(
      "src/services/example.ts",
      'import type { Database } from "../db/client.js";\n',
    );
    expect(messages).toHaveLength(1);
  });

  it("is refused to a re-export of a schema table", async () => {
    const messages = await restrictedImportMessages(
      "src/lib/example.ts",
      'export { tools } from "../db/schema/index.js";\n',
    );
    expect(messages).toHaveLength(1);
  });

  it("is refused to a service that imports drizzle-orm", async () => {
    const messages = await restrictedImportMessages(
      "src/services/audit/example.ts",
      'import { eq } from "drizzle-orm";\nimport { pgTable } from "drizzle-orm/pg-core";\n',
    );
    expect(messages).toHaveLength(2);
  });

  it("is refused to a module that imports the Postgres driver", async () => {
    const messages = await restrictedImportMessages(
      "src/middleware/example.ts",
      'import pg from "pg";\n',
    );
    expect(messages).toHaveLength(1);
  });

  it("is allowed in repositories", async () => {
    const messages = await restrictedImportMessages(
      "src/repositories/example.ts",
      'import { eq } from "drizzle-orm";\nimport type { Database } from "../db/client.js";\n',
    );
    expect(messages).toEqual([]);
  });

  it("is allowed in the database scripts", async () => {
    const messages = await restrictedImportMessages(
      "src/db/scripts/example.ts",
      'import { connect } from "../client.js";\nimport pg from "pg";\n',
    );
    expect(messages).toEqual([]);
  });

  it("is allowed in tests", async () => {
    const messages = await restrictedImportMessages(
      "test/integration/example.test.ts",
      'import { tools } from "../../src/db/schema/index.js";\n',
    );
    expect(messages).toEqual([]);
  });

  it("is not needed to use the repositories from a route", async () => {
    const messages = await restrictedImportMessages(
      "src/routes/example.ts",
      'import { createRepositories } from "../repositories/index.js";\n',
    );
    expect(messages).toEqual([]);
  });

  it("does not catch unrelated modules with db in their name", async () => {
    const messages = await restrictedImportMessages(
      "src/routes/example.ts",
      'import { thing } from "../lib/mongodb-helpers.js";\nimport { other } from "./dbx.js";\n',
    );
    expect(messages).toEqual([]);
  });
});
