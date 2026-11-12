import type { MigrationOptions } from "../config.js";
import { localReportTarget, localSource } from "./local.js";
import { s3ReportTarget, s3Source, type S3Access } from "./s3.js";
import type { MigrationSource, MigrationSources, ReportTarget, StorageLocation } from "./types.js";

export { localReportTarget, localSource } from "./local.js";
export {
  s3Address,
  s3ReportTarget,
  s3Source,
  type S3Access,
  type S3ListPage,
  type S3Prefix,
} from "./s3.js";
export {
  DEFAULT_MAX_OBJECT_BYTES,
  MigrationStorageError,
  type MigrationSource,
  type MigrationSources,
  type ReportTarget,
  type S3Location,
  type StorageLocation,
} from "./types.js";

export interface MigrationStorage {
  readonly sources: MigrationSources;
  readonly reports: ReportTarget;
}

/**
 * The inputs and report location from the options. An S3 client is only made
 * if one of them is in S3, and then one client is shared.
 */
export function openStorage(options: MigrationOptions, makeS3: () => S3Access): MigrationStorage {
  let client: S3Access | undefined;
  const s3 = (): S3Access => (client ??= makeS3());

  const source = (location: StorageLocation): MigrationSource =>
    location.kind === "local" ? localSource(location.dir) : s3Source(location, s3());
  const reports: ReportTarget =
    options.reports.kind === "local"
      ? localReportTarget(options.reports.dir)
      : s3ReportTarget(options.reports, s3());

  return { sources: { data: source(options.data), build: source(options.build) }, reports };
}
