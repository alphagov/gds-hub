import {
  DEFAULT_MAX_OBJECT_BYTES,
  MigrationStorageError,
  assertReportName,
  isSafeRelativePath,
  type MigrationSource,
  type ReportTarget,
} from "./types.js";

/** A bucket and a prefix in it. An S3 StorageLocation is one. */
export interface S3Prefix {
  readonly bucket: string;
  /** Empty for the whole bucket, and otherwise ends with "/". */
  readonly prefix: string;
}

/** One page of an S3 listing. */
export interface S3ListPage {
  readonly objects: readonly { readonly key: string; readonly size: number }[];
  /** Set when there are more objects to list. */
  readonly nextContinuationToken?: string;
}

/**
 * The few S3 operations the migration uses. aws-s3.ts implements them with the
 * AWS SDK, and the tests with an in-memory fake.
 */
export interface S3Access {
  listPage(input: {
    readonly bucket: string;
    readonly prefix: string;
    readonly continuationToken?: string | undefined;
  }): Promise<S3ListPage>;
  /** Reads an object as UTF-8 text. Fails if it is larger than `maxBytes`. */
  getText(input: {
    readonly bucket: string;
    readonly key: string;
    readonly maxBytes: number;
  }): Promise<string>;
  /** Writes an object, failing with MigrationStorageError if one already has the key. */
  putNew(input: {
    readonly bucket: string;
    readonly key: string;
    readonly body: string;
    readonly contentType: string;
  }): Promise<void>;
}

export interface S3SourceOptions {
  readonly maxObjectBytes?: number;
}

export function s3Address(location: S3Prefix, key = location.prefix): string {
  return `s3://${location.bucket}/${key}`;
}

/** How many refused keys to name in the error. */
const KEYS_NAMED = 5;

/**
 * The objects under an S3 prefix, as input files. Folder markers (keys ending
 * in "/") are skipped. A key that isn't a safe relative path fails the
 * listing, rather than being guessed at.
 */
export function s3Source(
  location: S3Prefix,
  s3: S3Access,
  options: S3SourceOptions = {},
): MigrationSource {
  const maxBytes = options.maxObjectBytes ?? DEFAULT_MAX_OBJECT_BYTES;
  const sizes = new Map<string, number>();

  return {
    label: s3Address(location),

    async list() {
      const paths: string[] = [];
      const refused: string[] = [];
      let continuationToken: string | undefined;
      do {
        const page = await s3.listPage({
          bucket: location.bucket,
          prefix: location.prefix,
          continuationToken,
        });
        for (const { key, size } of page.objects) {
          if (!key.startsWith(location.prefix)) continue;
          const relative = key.slice(location.prefix.length);
          if (relative === "" || relative.endsWith("/")) continue;
          if (!isSafeRelativePath(relative)) {
            refused.push(key);
            continue;
          }
          sizes.set(relative, size);
          paths.push(relative);
        }
        continuationToken = page.nextContinuationToken;
      } while (continuationToken !== undefined);

      if (refused.length > 0) {
        // JSON quoting shows control characters as escapes, so the log stays readable.
        const named = refused.slice(0, KEYS_NAMED).map((key) => JSON.stringify(key));
        throw new MigrationStorageError(
          `${String(refused.length)} objects in ${s3Address(location)} have keys that aren't plain paths, so nothing was read: ${named.join(", ")}`,
        );
      }
      return paths.sort();
    },

    async readText(relative) {
      if (!isSafeRelativePath(relative)) {
        throw new MigrationStorageError("an input path must be a plain path inside its prefix");
      }
      const size = sizes.get(relative);
      if (size !== undefined && size > maxBytes) {
        throw new MigrationStorageError(
          `${s3Address(location, location.prefix + relative)} is larger than ${String(maxBytes)} bytes`,
        );
      }
      return await s3.getText({
        bucket: location.bucket,
        key: location.prefix + relative,
        maxBytes,
      });
    },
  };
}

/** An S3 prefix for reports. Each report is a new object; none is ever replaced. */
export function s3ReportTarget(location: S3Prefix, s3: S3Access): ReportTarget {
  return {
    label: s3Address(location),
    async write(name, text) {
      assertReportName(name);
      const key = location.prefix + name;
      await s3.putNew({
        bucket: location.bucket,
        key,
        body: text,
        contentType: "application/json",
      });
      return s3Address(location, key);
    },
  };
}
