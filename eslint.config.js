// @ts-check
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/", "coverage/", "test-results/", "playwright-report/", "eslint.config.js"],
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-console": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Routes -> services -> repositories -> db. Only repositories (and the
    // database scripts in src/db) may use the database, so every write goes
    // through a repository and is audited. Type-only imports and re-exports
    // are caught too. Tests are outside src, so they can still set up and
    // inspect the database directly.
    files: ["src/**/*.ts"],
    ignores: ["src/repositories/**", "src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(drizzle-orm|pg)(/.*)?$",
              message:
                "Only src/repositories can use the database. Use a repository from src/repositories instead.",
            },
            {
              regex: "(^|/)db(/|$)",
              message:
                "Only src/repositories can import src/db. Use a repository from src/repositories instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // The logger is the only module allowed to write to the console.
    files: ["src/lib/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Vitest's asymmetric matchers (expect.any etc.) are typed as `any`.
    files: ["test/**/*.ts"],
    rules: { "@typescript-eslint/no-unsafe-assignment": "off" },
  },
);
