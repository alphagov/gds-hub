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
