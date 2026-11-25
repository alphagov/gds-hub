import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Markdown is the only way content reaches a page as HTML, and it is
// sanitised in src/lib/markdown.ts. These tests keep the two places that
// could bypass that to one each.

const ROOT = join(import.meta.dirname, "..", "..");

function filesUnder(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name));
}

function relativeNames(files: readonly string[]): string[] {
  return files.map((file) => relative(ROOT, file).replaceAll("\\", "/")).sort();
}

describe("unsanitised HTML", () => {
  it("is only output by the rendered markdown partial", () => {
    const usingSafe = filesUnder(join(ROOT, "views"), ".njk").filter((file) =>
      /\|\s*safe\b|\bmarkSafe\b|\{%-?\s*autoescape\s+false/.test(readFileSync(file, "utf8")),
    );

    expect(relativeNames(usingSafe)).toEqual(["views/partials/rendered-markdown.njk"]);
  });

  it("is only branded as safe in the markdown module", () => {
    const branding = filesUnder(join(ROOT, "src"), ".ts").filter((file) =>
      /\bas\s+SafeHtml\b|<SafeHtml>/.test(readFileSync(file, "utf8")),
    );

    expect(relativeNames(branding)).toEqual(["src/lib/markdown.ts"]);
  });
});
