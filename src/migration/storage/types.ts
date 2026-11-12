/**
 * Where the migration reads its inputs and writes its reports: a local folder,
 * or a prefix in an S3 bucket. The same code runs against either, so a local
 * run and a run in AWS read the same files in the same way.
 */

export type StorageLocation =
  | { readonly kind: "local"; readonly dir: string }
  /** `prefix` is empty for a whole bucket, and otherwise ends with "/". */
  | { readonly kind: "s3"; readonly bucket: string; readonly prefix: string };

export type S3Location = Extract<StorageLocation, { kind: "s3" }>;

/** A folder of input files: the built HTML or the YAML data files. */
export interface MigrationSource {
  /** Where it is, for the logs: a folder or an s3:// address. Never holds a credential. */
  readonly label: string;
  /** Every file, as sorted paths relative to the folder, with "/" separators. */
  list(): Promise<string[]>;
  /** A file's contents as UTF-8 text. `path` is relative to the folder. */
  readText(path: string): Promise<string>;
}

export interface MigrationSources {
  readonly data: MigrationSource;
  readonly build: MigrationSource;
}

/** Somewhere to write reports. */
export interface ReportTarget {
  readonly label: string;
  /**
   * Writes a new report and returns where it went. Never replaces an earlier
   * one: fails if a report with the same name exists. `name` must be a plain
   * file name.
   */
  write(name: string, text: string): Promise<string>;
}

/** Reading or writing an input or a report failed. The message never holds file contents. */
export class MigrationStorageError extends Error {
  override readonly name = "MigrationStorageError";
}

/** The largest file the migration reads. Built pages and data files are far smaller. */
export const DEFAULT_MAX_OBJECT_BYTES = 10 * 1024 * 1024;

const REPORT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Throws unless `name` is a plain file name, so a report can't be written anywhere else. */
export function assertReportName(name: string): void {
  if (!REPORT_NAME.test(name) || name.includes("..")) {
    throw new MigrationStorageError("a report name must be a plain file name");
  }
}

/**
 * Whether a relative path is safe to use as it is: segments separated by
 * single slashes, none of them "." or "..", and no backslashes or control
 * characters.
 */
export function isSafeRelativePath(relative: string): boolean {
  if (relative === "" || relative.includes("\\") || /\p{Cc}/u.test(relative)) return false;
  return relative
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
