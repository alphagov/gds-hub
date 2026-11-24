import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepositories, type Repositories } from "../../src/repositories/index.js";
import { systemActor } from "../../src/services/audit/actor.js";
import { createMigratedTestDatabase, type TestDatabase } from "./test-database.js";

// Pages of every type and status, owned by two teams. All values are invented.

const actor = systemActor("data_migration");

let testDatabase: TestDatabase | undefined;
let repos: Repositories;
const ids = { alpha: 0, beta: 0 };

async function page(
  slug: string,
  pageType: "policy" | "guidance" | "service_guide" | "general" | "whats_new",
  extra: { status?: "draft" | "published"; team?: number; title?: string } = {},
): Promise<void> {
  await repos.pages.create(
    {
      slug,
      title: extra.title ?? slug,
      pageType,
      bodyMarkdown: "Body.",
      ownerName: "Someone",
      status: extra.status ?? "published",
      productTeamServiceId: extra.team ?? null,
    },
    actor,
  );
}

beforeAll(async () => {
  const created = await createMigratedTestDatabase();
  testDatabase = created;
  repos = createRepositories(created.db);
  ids.alpha = (
    await repos.productTeamServices.create({ key: "alpha", slug: "alpha", name: "Alpha" }, actor)
  ).id;
  ids.beta = (
    await repos.productTeamServices.create({ key: "beta", slug: "beta", name: "Beta" }, actor)
  ).id;

  await page("zebra-policy", "policy", { title: "Zebra policy" });
  await page("apple-policy", "policy", { title: "Apple policy" });
  await page("draft-policy", "policy", { status: "draft" });
  await page("general-advice", "guidance", { title: "General advice" });
  await page("alpha-guide", "service_guide", { team: ids.alpha, title: "Alpha guide" });
  await page("alpha-draft-guide", "service_guide", { team: ids.alpha, status: "draft" });
  await page("beta-guide", "service_guide", { team: ids.beta });
  await page("about", "general");
  await page("news", "whats_new");
});

afterAll(async () => {
  await testDatabase?.drop();
});

describe("the content read repository", () => {
  it("lists published pages of the given types, in title order", async () => {
    const policies = await repos.content.publishedPages(["policy"]);

    expect(policies.map((p) => p.slug)).toEqual(["apple-policy", "zebra-policy"]);
  });

  it("lists more than one type together", async () => {
    const guidance = await repos.content.publishedPages(["guidance", "service_guide"]);

    expect(guidance.map((p) => p.slug).sort()).toEqual([
      "alpha-guide",
      "beta-guide",
      "general-advice",
    ]);
  });

  it("never lists a draft", async () => {
    const all = await repos.content.publishedPages([
      "policy",
      "guidance",
      "service_guide",
      "general",
      "whats_new",
    ]);

    expect(all.map((p) => p.slug)).not.toContain("draft-policy");
    expect(all.map((p) => p.slug)).not.toContain("alpha-draft-guide");
  });

  it("finds a published page of the right type, with the team that owns it", async () => {
    const found = await repos.content.publishedPage("alpha-guide", ["guidance", "service_guide"]);

    expect(found?.page.title).toBe("Alpha guide");
    expect(found?.productTeamService).toMatchObject({ slug: "alpha", name: "Alpha" });
  });

  it("gives no owning team to a page that has none", async () => {
    const found = await repos.content.publishedPage("apple-policy", ["policy"]);

    expect(found?.productTeamService).toBeNull();
  });

  it("does not find a draft, a page of another type or an unknown slug", async () => {
    expect(await repos.content.publishedPage("draft-policy", ["policy"])).toBeUndefined();
    expect(await repos.content.publishedPage("apple-policy", ["guidance"])).toBeUndefined();
    expect(await repos.content.publishedPage("no-such-page", ["policy"])).toBeUndefined();
  });

  it("lists only a team's own published service guides", async () => {
    const guides = await repos.content.publishedServiceGuides(ids.alpha);

    expect(guides.map((p) => p.slug)).toEqual(["alpha-guide"]);
  });

  it("lists no guides for a team that has none", async () => {
    expect(await repos.content.publishedServiceGuides(999_999)).toEqual([]);
  });
});
