import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MigrationStorageError,
  assertReportName,
  type MigrationSource,
  type ReportTarget,
} from "./types.js";

/** Every file under a folder, as sorted paths with "/" separators. Symbolic links aren't followed. */
async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) found.push(relative);
    }
  };
  await walk(root, "");
  return found.sort();
}

/** The full path of a file inside `dir`. Throws for a path that would leave it. */
function insideFolder(dir: string, relative: string): string {
  if (path.isAbsolute(relative)) {
    throw new MigrationStorageError("an input path must be relative to its folder");
  }
  const target = path.resolve(dir, relative);
  const fromDir = path.relative(dir, target);
  if (
    fromDir === "" ||
    fromDir === ".." ||
    fromDir.startsWith(`..${path.sep}`) ||
    path.isAbsolute(fromDir)
  ) {
    throw new MigrationStorageError("an input path must be inside its folder");
  }
  return target;
}

/** A local folder of input files. The folder's location is checked by loadMigrationOptions. */
export function localSource(dir: string): MigrationSource {
  return {
    label: dir,
    list: () => listFiles(dir),
    readText: async (relative) => readFile(insideFolder(dir, relative), "utf8"),
  };
}

/** A local folder for reports, created if it doesn't exist. */
export function localReportTarget(dir: string): ReportTarget {
  return {
    label: dir,
    async write(name, text) {
      assertReportName(name);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, name);
      await writeFile(file, text, { flag: "wx" });
      return file;
    },
  };
}
