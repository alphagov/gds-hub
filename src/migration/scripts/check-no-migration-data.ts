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

const GITLINK_MODE = "160000";

/** A file as the check sees it: text, or undefined for a binary or very large file. */
function toRepoFile(file: string, bytes: Buffer): RepoFile {
  const binary = bytes.length > MAX_TEXT_BYTES || bytes.includes(0);
  return { path: file, content: binary ? undefined : bytes.toString("utf8") };
}

async function git(args: string[]): Promise<Buffer> {
  const { stdout } = await run("git", args, {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/**
 * What would be committed (the staged version of each tracked file) and what
 * is in the working tree. A file changed after staging is checked in both
 * forms, so cleaning it up without staging the change doesn't hide it. A
 * staged file that can't be read fails the check.
 */
async function repoFiles(): Promise<RepoFile[]> {
  const files: RepoFile[] = [];

  const staged = (await git(["ls-files", "-z", "--stage"])).toString("utf8").split("\0");
  const entries = new Map<string, string>();
  for (const entry of staged) {
    const match = /^(\d+) ([0-9a-f]+) \d\t(.+)$/s.exec(entry);
    if (match === null || match[1] === GITLINK_MODE) continue;
    entries.set(`${match[2]}\0${match[3]}`, match[3] ?? "");
  }
  for (const [key, file] of entries) {
    const sha = key.slice(0, key.indexOf("\0"));
    const blob = await git(["cat-file", "blob", sha]);
    files.push(toRepoFile(file, blob));
    try {
      const current = await readFile(path.join(REPO_ROOT, file));
      if (!current.equals(blob)) files.push(toRepoFile(file, current));
    } catch {
      // Deleted from the working tree. The staged version has been checked.
    }
  }

  const untracked = (await git(["ls-files", "-z", "--others", "--exclude-standard"]))
    .toString("utf8")
    .split("\0")
    .filter((file) => file !== "");
  for (const file of new Set(untracked)) {
    files.push(toRepoFile(file, await readFile(path.join(REPO_ROOT, file))));
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
