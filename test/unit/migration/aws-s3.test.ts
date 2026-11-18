import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { awsS3Access } from "../../../src/migration/storage/aws-s3.js";
import { MigrationStorageError } from "../../../src/migration/storage/index.js";

// The adapter is tested with a real S3Client whose requests are answered by a
// middleware before they are signed or sent, so nothing reaches the network
// and no credentials are needed (the credentials provider fails if asked).

interface SentCommand {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

type Answer = (command: SentCommand) => object;

function fakeClient(answer: Answer): { client: S3Client; sent: SentCommand[] } {
  const sent: SentCommand[] = [];
  const client = new S3Client({
    region: "eu-west-2",
    credentials: () => Promise.reject(new Error("the tests never sign a request")),
  });
  client.middlewareStack.add(
    (_next, context) => (args) => {
      const command = {
        name: context.commandName ?? "",
        input: args.input as unknown as Record<string, unknown>,
      };
      sent.push(command);
      try {
        const output = { $metadata: {}, ...answer(command) };
        return Promise.resolve({ output: output as never, response: {} });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("failed"));
      }
    },
    { step: "initialize", priority: "low", name: "answerInTests" },
  );
  return { client, sent };
}

function body(text: string): object {
  return { transformToString: () => Promise.resolve(text) };
}

describe("the AWS S3 adapter", () => {
  it("lists one page of objects under a prefix", async () => {
    const { client, sent } = fakeClient(() => ({
      Contents: [
        { Key: "hub-build/about.html", Size: 120 },
        { Key: "hub-build/tools/index.html", Size: 300 },
      ],
      IsTruncated: true,
      NextContinuationToken: "next-page",
    }));
    const page = await awsS3Access(client).listPage({
      bucket: "example-hub-migration",
      prefix: "hub-build/",
      continuationToken: "this-page",
    });
    expect(sent).toEqual([
      {
        name: "ListObjectsV2Command",
        input: expect.objectContaining({
          Bucket: "example-hub-migration",
          Prefix: "hub-build/",
          ContinuationToken: "this-page",
        }),
      },
    ]);
    expect(page).toEqual({
      objects: [
        { key: "hub-build/about.html", size: 120 },
        { key: "hub-build/tools/index.html", size: 300 },
      ],
      nextContinuationToken: "next-page",
    });
  });

  it("gives no next page when the listing is complete", async () => {
    const { client } = fakeClient(() => ({
      Contents: [{ Key: "hub-data/tools.yml", Size: 10 }],
      IsTruncated: false,
    }));
    const page = await awsS3Access(client).listPage({
      bucket: "example-hub-migration",
      prefix: "hub-data/",
    });
    expect(page).toEqual({ objects: [{ key: "hub-data/tools.yml", size: 10 }] });
  });

  it("gives an empty page when nothing is under the prefix", async () => {
    const { client } = fakeClient(() => ({ KeyCount: 0, IsTruncated: false }));
    expect(
      await awsS3Access(client).listPage({ bucket: "example-hub-migration", prefix: "none/" }),
    ).toEqual({ objects: [] });
  });

  it("reads an object as text", async () => {
    const { client, sent } = fakeClient(() => ({
      Body: body("# SYNTHETIC FIXTURE\n"),
      ContentLength: 20,
    }));
    const text = await awsS3Access(client).getText({
      bucket: "example-hub-migration",
      key: "hub-data/tools.yml",
      maxBytes: 1024,
    });
    expect(text).toBe("# SYNTHETIC FIXTURE\n");
    expect(sent[0]).toEqual({
      name: "GetObjectCommand",
      input: expect.objectContaining({
        Bucket: "example-hub-migration",
        Key: "hub-data/tools.yml",
      }),
    });
  });

  it("refuses an object larger than the limit without reading its body", async () => {
    let bodyRead = false;
    const { client } = fakeClient(() => ({
      Body: {
        transformToString: () => {
          bodyRead = true;
          return Promise.resolve("x");
        },
      },
      ContentLength: 5000,
    }));
    await expect(
      awsS3Access(client).getText({
        bucket: "example-hub-migration",
        key: "big.html",
        maxBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(MigrationStorageError);
    expect(bodyRead).toBe(false);
  });

  it("writes a new object only if there isn't one with the same key", async () => {
    const { client, sent } = fakeClient(() => ({}));
    await awsS3Access(client).putNew({
      bucket: "example-hub-migration",
      key: "reports/load-1.json",
      body: "{}\n",
      contentType: "application/json",
    });
    expect(sent[0]).toEqual({
      name: "PutObjectCommand",
      input: expect.objectContaining({
        Bucket: "example-hub-migration",
        Key: "reports/load-1.json",
        Body: "{}\n",
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    });
  });

  it("says a report already exists when S3 refuses to replace it", async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(
        new Error("At least one of the pre-conditions you specified did not hold"),
        {
          name: "PreconditionFailed",
          $metadata: { httpStatusCode: 412 },
        },
      );
    });
    const write = awsS3Access(client).putNew({
      bucket: "example-hub-migration",
      key: "reports/load-1.json",
      body: "{}\n",
      contentType: "application/json",
    });
    await expect(write).rejects.toBeInstanceOf(MigrationStorageError);
    await expect(write).rejects.toThrow(/already exists/);
  });
});
