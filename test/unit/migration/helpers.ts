import os from "node:os";
import path from "node:path";
import {
  FIXTURES_DIR,
  loadMigrationOptions,
  type MigrationOptions,
} from "../../../src/migration/config.js";

/** The synthetic stand-in for HUB_DATA_DIR. */
export const FIXTURE_DATA_DIR = path.join(FIXTURES_DIR, "hub-data");

/** The synthetic stand-in for HUB_BUILD_DIR. */
export const FIXTURE_BUILD_DIR = path.join(FIXTURES_DIR, "hub-build");

/** The old site's address in the fixtures. Absolute links to it are internal. */
export const FIXTURE_SITE_ORIGIN = "https://hub.example.com";

/** Migration options for the fixture folders, with reports in the temporary directory. */
export function fixtureOptions(): MigrationOptions {
  return loadMigrationOptions(
    {
      data: FIXTURE_DATA_DIR,
      build: FIXTURE_BUILD_DIR,
      siteOrigin: FIXTURE_SITE_ORIGIN,
      reportDir: path.join(os.tmpdir(), "gds-hub-migration-tests"),
    },
    {},
  );
}

/** Wraps content in a minimal stand-in for the current Hub's shared layout. */
export function builtPage(content: string, contentTag = "main"): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head><title>Example</title></head>
  <body>
    <header class="site-header"><a href="/">Example Hub</a></header>
    <nav class="site-navigation"><ul><li><a href="/tools/">Tools in the menu</a></li></ul></nav>
    <div class="site-pane__toc"><nav id="site-toc"><a href="/tools/kettle-board/">Left-hand link</a></nav></div>
    <${contentTag}>${content}</${contentTag}>
    <aside class="site-contribution"><a href="https://example.com/edit">Edit this page</a></aside>
    <footer class="site-footer"><p>Example footer text</p></footer>
  </body>
</html>`;
}
