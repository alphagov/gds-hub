import { describe, expect, it } from "vitest";
import { buildMigrationPlan } from "../../../src/migration/inventory.js";
import { s3Source } from "../../../src/migration/storage/index.js";
import { FakeS3 } from "./fake-s3.js";
import { FIXTURE_BUILD_DIR, FIXTURE_DATA_DIR, fixtureOptions, fixtureSources } from "./helpers.js";

const BUCKET = "example-hub-migration";

describe("an inventory read from S3", () => {
  it("is exactly the same as one read from the same files on disk", async () => {
    const s3 = new FakeS3();
    s3.putFolder(BUCKET, "frozen/hub-data/", FIXTURE_DATA_DIR);
    s3.putFolder(BUCKET, "frozen/hub-build/", FIXTURE_BUILD_DIR);
    s3.pageSize = 5;

    const fromS3 = await buildMigrationPlan(
      {
        data: s3Source({ bucket: BUCKET, prefix: "frozen/hub-data/" }, s3),
        build: s3Source({ bucket: BUCKET, prefix: "frozen/hub-build/" }, s3),
      },
      fixtureOptions(),
    );
    const fromDisk = await buildMigrationPlan(fixtureSources(), fixtureOptions());

    expect(fromS3).toEqual(fromDisk);
  });

  it("downloads only built pages and data files, not images or stylesheets", async () => {
    const s3 = new FakeS3();
    s3.putFolder(BUCKET, "hub-data/", FIXTURE_DATA_DIR);
    s3.putFolder(BUCKET, "hub-build/", FIXTURE_BUILD_DIR);

    const plan = await buildMigrationPlan(
      {
        data: s3Source({ bucket: BUCKET, prefix: "hub-data/" }, s3),
        build: s3Source({ bucket: BUCKET, prefix: "hub-build/" }, s3),
      },
      fixtureOptions(),
    );

    expect(s3.reads.length).toBeGreaterThan(0);
    for (const read of s3.reads) expect(read).toMatch(/\.(html?|ya?ml)$/);
    // The image is still found in the listing.
    expect(plan.assets.find((asset) => asset.path === "/images/widgets/diagram.svg")?.exists).toBe(
      true,
    );
  });
});
