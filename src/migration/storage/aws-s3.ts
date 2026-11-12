import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { S3Access, S3ListPage } from "./s3.js";
import { MigrationStorageError } from "./types.js";

/**
 * S3Access through the AWS SDK. The client finds its region and credentials
 * the SDK's usual way: in AWS, the ECS task role and AWS_REGION. They are
 * never passed as options or kept in the repository.
 */
export function awsS3Access(client: S3Client): S3Access {
  return {
    async listPage({ bucket, prefix, continuationToken }) {
      const output = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects = (output.Contents ?? []).flatMap((object) =>
        object.Key === undefined ? [] : [{ key: object.Key, size: object.Size ?? 0 }],
      );
      const next = output.IsTruncated === true ? output.NextContinuationToken : undefined;
      const page: S3ListPage =
        next === undefined ? { objects } : { objects, nextContinuationToken: next };
      return page;
    },

    async getText({ bucket, key, maxBytes }) {
      const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = output.Body;
      const tooLarge = `s3://${bucket}/${key} is larger than ${String(maxBytes)} bytes`;
      if (output.ContentLength !== undefined && output.ContentLength > maxBytes) {
        // Close the download rather than leave it open.
        (body as unknown as { destroy?: () => void } | undefined)?.destroy?.();
        throw new MigrationStorageError(tooLarge);
      }
      if (body === undefined) {
        throw new MigrationStorageError(`s3://${bucket}/${key} has no contents`);
      }
      const text = await body.transformToString("utf-8");
      if (Buffer.byteLength(text) > maxBytes) throw new MigrationStorageError(tooLarge);
      return text;
    },

    async putNew({ bucket, key, body, contentType }) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            // Only if nothing has this key yet, so a report is never replaced.
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        if (isConditionFailure(error)) {
          throw new MigrationStorageError(`a report already exists at s3://${bucket}/${key}`);
        }
        throw error;
      }
    },
  };
}

/** Whether S3 refused a conditional write because the object exists (412), or a write raced it (409). */
function isConditionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "PreconditionFailed" || error.name === "ConditionalRequestConflict") {
    return true;
  }
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return status === 412 || status === 409;
}

/** S3Access with a client configured from the environment. */
export function createAwsS3Access(): S3Access {
  return awsS3Access(new S3Client({}));
}
