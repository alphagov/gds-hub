import { REPORT_KIND } from "./report.js";

/**
 * Spots files that look like migrated or source data from the current Hub,
 * so they are never committed: migration output, reference material, logs,
 * dumps, exports, built Hub pages, Hub-shaped YAML and fixtures that aren't
 * marked as synthetic. Reasons never quote a file.
 */

/** Every file in the migration fixtures must contain this, to show it is invented. */
export const SYNTHETIC_MARKER = "SYNTHETIC FIXTURE";

export interface RepoFile {
  /** The path relative to the repository root, with "/" separators. */
  readonly path: string;
  /** The text, or undefined for a binary or very large file. */
  readonly content: string | undefined;
}

export interface DataProblem {
  readonly path: string;
  readonly reason: string;
}

const FIXTURES_PREFIX = "test/fixtures/migration/";

/** Git ignores these, so a file here was added on purpose. */
const OUTPUT_PREFIXES = ["migration-data/", "migration-reports/", "db-reference-material/"];

// Built from parts so this file doesn't look like the things it checks for.
const DUMP_HEADER = ["PostgreSQL", "database", "dump"].join(" ");

/** Markup the current Hub's layout (GOV.UK tech docs) puts on every built page. */
const BUILT_HUB_MARKERS = [
  `class="${["technical", "documentation"].join("-")}"`,
  ["app-pane", "content"].join("__"),
  ["govuk", "tech", "docs"].join("_"),
];

/** Field names only the current Hub's data files use. */
const HUB_YAML_FIELD =
  /^[ \t]+(uses|operates|getting_access|gh_orgs|ownership_level|target_ownership_level|identity_migration_status|supported_by_gds_software_service_desk):/m;

function problemWith({ path, content }: RepoFile): string | undefined {
  const lower = path.toLowerCase();

  if (OUTPUT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return "migration output and reference material must never be committed";
  }
  if (lower.endsWith(".migration.log")) return "migration logs must never be committed";
  if (
    /\.(dump|backup|bak|pgdump)$/.test(lower) ||
    (/\.sql(\.gz)?$/.test(lower) && !path.startsWith("drizzle/"))
  ) {
    return "it looks like a database dump";
  }
  if (/\.(csv|tsv|xlsx?|ods)$/.test(lower)) return "it looks like a data export";

  if (path.startsWith(FIXTURES_PREFIX)) {
    if (content === undefined) return "migration fixtures must be text files marked as synthetic";
    if (!content.includes(SYNTHETIC_MARKER)) {
      return `migration fixtures must contain "${SYNTHETIC_MARKER}" to show they are invented`;
    }
    return undefined;
  }

  if (content === undefined) return undefined;
  if (content.slice(0, 1024).includes(DUMP_HEADER)) return "it looks like a database dump";
  if (
    /\.(html?|erb)$/.test(lower) &&
    BUILT_HUB_MARKERS.some((marker) => content.includes(marker))
  ) {
    return "it looks like a built page from the current Hub";
  }
  if (/\.ya?ml$/.test(lower) && !path.startsWith(".github/") && HUB_YAML_FIELD.test(content)) {
    return "it looks like the current Hub's YAML data";
  }
  if (lower.endsWith(".json") && content.includes(REPORT_KIND)) {
    return "it looks like a migration report";
  }
  return undefined;
}

export function findMigrationDataProblems(files: readonly RepoFile[]): DataProblem[] {
  return files.flatMap((file) => {
    const reason = problemWith(file);
    return reason === undefined ? [] : [{ path: file.path, reason }];
  });
}
