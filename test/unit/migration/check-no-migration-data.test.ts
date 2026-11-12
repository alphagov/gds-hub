import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_MARKER,
  findMigrationDataProblems,
  type RepoFile,
} from "../../../src/migration/check-no-migration-data.js";

function text(path: string, content: string): RepoFile {
  return { path, content };
}

function problemPaths(files: readonly RepoFile[]): string[] {
  return findMigrationDataProblems(files).map((problem) => problem.path);
}

// Built up so this test file doesn't itself look like the things it checks for.
const DUMP_HEADER = ["--", "PostgreSQL", "database", "dump"].join(" ");
const BUILT_HUB_PAGE = `<main id="content" class="${["technical", "documentation"].join("-")}"><h1>Real page</h1></main>`;
const REPORT_KIND = ["gds-hub", "migration-report"].join("-");

describe("checking for migration data", () => {
  it("passes the repository's own kinds of file", () => {
    expect(
      problemPaths([
        text("src/app.ts", "export const app = 1;\n"),
        text("views/pages/tool.njk", "{% extends 'layouts/base.njk' %}\n"),
        text("drizzle/0000_init.sql", "CREATE TABLE tools ();\n"),
        text(
          ".github/workflows/test.yml",
          "on:\n  pull_request:\njobs:\n  uses: actions/checkout\n",
        ),
        text("docs/migration.md", "# Migrating content\n"),
        text(
          "test/fixtures/migration/hub-data/tools.yml",
          `# ${SYNTHETIC_MARKER}\nkettle:\n  name: Kettle\n`,
        ),
        text("package.json", '{ "name": "gds-hub" }\n'),
      ]),
    ).toEqual([]);
  });

  it.each([
    "migration-data/records.json",
    "migration-reports/inventory-2026-11-11.json",
    "db-reference-material/yaml-examples/tools.yml",
    "notes/apply.migration.log",
  ])("flags %s", (path) => {
    expect(problemPaths([text(path, "anything\n")])).toEqual([path]);
  });

  it("flags database dumps by name and by content", () => {
    expect(
      problemPaths([
        text("backups/hub.dump", "x"),
        text("backups/hub.backup", "x"),
        text("seed/export.sql", "INSERT INTO tools VALUES (1);\n"),
        text("notes/dump.txt", `${DUMP_HEADER}\n-- Dumped from database version 18\n`),
      ]),
    ).toEqual(["backups/hub.dump", "backups/hub.backup", "seed/export.sql", "notes/dump.txt"]);
  });

  it("flags data exports", () => {
    expect(
      problemPaths([
        text("exports/tools.csv", "key,name\n"),
        { path: "exports/tools.xlsx", content: undefined },
      ]),
    ).toEqual(["exports/tools.csv", "exports/tools.xlsx"]);
  });

  it("flags a built page from the current Hub outside the fixtures", () => {
    expect(problemPaths([text("examples/aws.html", BUILT_HUB_PAGE)])).toEqual([
      "examples/aws.html",
    ]);
  });

  it("flags YAML shaped like the current Hub's data outside the fixtures", () => {
    expect(
      problemPaths([
        text(
          "data/products_teams_and_services.yml",
          "real-team:\n  name: Real Team\n  uses:\n    - real-tool\n",
        ),
        text(
          "config/instances.yaml",
          "real:\n  tool: real-tool\n  getting_access: Ask a real person\n",
        ),
      ]),
    ).toEqual(["data/products_teams_and_services.yml", "config/instances.yaml"]);
  });

  it("flags a migration report outside the report folders", () => {
    expect(problemPaths([text("docs/inventory.json", `{ "kind": "${REPORT_KIND}" }`)])).toEqual([
      "docs/inventory.json",
    ]);
  });

  it("flags a fixture that isn't marked as synthetic", () => {
    expect(
      problemPaths([
        text(
          "test/fixtures/migration/hub-build/tools/real/index.html",
          "<main><h1>Real</h1></main>",
        ),
        text("test/fixtures/migration/hub-data/tools.yml", "real:\n  name: Real\n"),
      ]),
    ).toEqual([
      "test/fixtures/migration/hub-build/tools/real/index.html",
      "test/fixtures/migration/hub-data/tools.yml",
    ]);
  });

  it("flags a binary file in the fixtures, which can't be marked as synthetic", () => {
    expect(
      problemPaths([
        { path: "test/fixtures/migration/hub-build/images/real.png", content: undefined },
      ]),
    ).toEqual(["test/fixtures/migration/hub-build/images/real.png"]);
  });

  it("allows built-page markup in a fixture marked as synthetic", () => {
    expect(
      problemPaths([
        text(
          "test/fixtures/migration/hub-build/index.html",
          `<!-- ${SYNTHETIC_MARKER} -->\n<main><h1>Invented</h1></main>`,
        ),
      ]),
    ).toEqual([]);
  });

  it("gives a reason for each problem, without quoting the file", () => {
    const [problem] = findMigrationDataProblems([text("examples/aws.html", BUILT_HUB_PAGE)]);
    expect(problem?.reason).toBeTruthy();
    expect(problem?.reason).not.toContain("Real page");
  });
});
