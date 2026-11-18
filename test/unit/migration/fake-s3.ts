import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  MigrationStorageError,
  type S3Access,
  type S3ListPage,
} from "../../../src/migration/storage/index.js";

/**
 * An in-memory stand-in for S3, so the S3 code paths are tested without the
 * network or the AWS SDK. Objects are keyed by bucket and key.
 */
export class FakeS3 implements S3Access {
  private readonly objects = new Map<string, string>();
  /** How many objects each listing page holds, to exercise pagination. */
  pageSize = 1000;
  /** Every listing request, in order. */
  readonly listRequests: { bucket: string; prefix: string; continuationToken?: string }[] = [];
  /** Every key read, in order, as "bucket/key". */
  readonly reads: string[] = [];

  /** Adds or replaces an object. */
  put(bucket: string, key: string, body: string): void {
    this.objects.set(`${bucket}/${key}`, body);
  }

  /** An object's body, or undefined if there isn't one. */
  get(bucket: string, key: string): string | undefined {
    return this.objects.get(`${bucket}/${key}`);
  }

  /** Every key in a bucket, sorted. */
  keys(bucket: string): string[] {
    return [...this.objects.keys()]
      .filter((id) => id.startsWith(`${bucket}/`))
      .map((id) => id.slice(bucket.length + 1))
      .sort();
  }

  /** Copies every file in a local folder into the bucket under the prefix. */
  putFolder(bucket: string, prefix: string, dir: string): void {
    const walk = (current: string, relative: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
        const childPath = path.join(current, entry.name);
        if (entry.isDirectory()) walk(childPath, childRelative);
        else if (entry.isFile()) {
          this.put(bucket, `${prefix}${childRelative}`, readFileSync(childPath, "utf8"));
        }
      }
    };
    walk(dir, "");
  }

  listPage(input: {
    readonly bucket: string;
    readonly prefix: string;
    readonly continuationToken?: string | undefined;
  }): Promise<S3ListPage> {
    this.listRequests.push({
      bucket: input.bucket,
      prefix: input.prefix,
      ...(input.continuationToken === undefined
        ? {}
        : { continuationToken: input.continuationToken }),
    });
    const matching = this.keys(input.bucket).filter((key) => key.startsWith(input.prefix));
    const start = input.continuationToken === undefined ? 0 : Number(input.continuationToken);
    const page = matching.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return Promise.resolve({
      objects: page.map((key) => ({
        key,
        size: Buffer.byteLength(this.get(input.bucket, key) ?? ""),
      })),
      ...(next < matching.length ? { nextContinuationToken: String(next) } : {}),
    });
  }

  getText(input: {
    readonly bucket: string;
    readonly key: string;
    readonly maxBytes: number;
  }): Promise<string> {
    this.reads.push(`${input.bucket}/${input.key}`);
    const body = this.get(input.bucket, input.key);
    if (body === undefined) {
      return Promise.reject(new MigrationStorageError("the object does not exist"));
    }
    if (Buffer.byteLength(body) > input.maxBytes) {
      return Promise.reject(new MigrationStorageError("the object is too large"));
    }
    return Promise.resolve(body);
  }

  putNew(input: {
    readonly bucket: string;
    readonly key: string;
    readonly body: string;
    readonly contentType: string;
  }): Promise<void> {
    if (this.get(input.bucket, input.key) !== undefined) {
      return Promise.reject(new MigrationStorageError("the object already exists"));
    }
    this.put(input.bucket, input.key, input.body);
    return Promise.resolve();
  }
}
