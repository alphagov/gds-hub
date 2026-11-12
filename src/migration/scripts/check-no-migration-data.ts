import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createJsonLogger } from "../../lib/logger.js";
import { findMigrationDataProblems, type RepoFile } from "../check-no-migration-data.js";
import { REPO_ROOT } from "../config.js";

// npm run check:no-migration-data
// Checks every file git tracks or would add (tracked, staged, and untracked
// but not ignored) for migrated or source data from the current Hub. Runs in
// the pre-commit hook and in CI.

/** Larger files are treated as binary: the check only reads text it can scan quickly. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const run = promisify(execFile);
const logger = createJsonLogger({ level: "info", base: { script: "check:no-migration-data" } });

async function repoFiles(): Promise<RepoFile[]> {
  const { stdout } = await run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  const paths = [...new Set(stdout.split("\0").filter((file) => file !== ""))];
  const files: RepoFile[] = [];
  for (const file of paths) {
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(REPO_ROOT, file));
    } catch {
      // Deleted from the working tree but still in the index.
      continue;
    }
    const binary = bytes.length > MAX_TEXT_BYTES || bytes.includes(0);
    files.push({ path: file, content: binary ? undefined : bytes.toString("utf8") });
  }
  return files;
}

try {
  const files = await repoFiles();
  const problems = findMigrationDataProblems(files);
  for (const problem of problems) {
    logger.error("this file must not be committed", { path: problem.path, reason: problem.reason });
  }
  if (problems.length > 0) {
    logger.error("migration data check failed", { problems: problems.length });
    process.exitCode = 1;
  } else {
    logger.info("no migration data found", { files: files.length });
  }
} catch (error) {
  logger.error("check:no-migration-data failed", { err: error });
  process.exitCode = 1;
}
