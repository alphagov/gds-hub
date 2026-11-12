import { describe, expect, it } from "vitest";
import type { RedirectLookup } from "../../src/repositories/index.js";
import { createRedirectService } from "../../src/services/redirects/redirect-service.js";

/** A redirect lookup over a fixed list, recording the paths it was asked for. */
function lookupOf(redirects: Record<string, string>) {
  const asked: (readonly string[])[] = [];
  const redirectLookup: RedirectLookup = {
    newPathsFor: (oldPaths) => {
      asked.push(oldPaths);
      return Promise.resolve(
        new Map(
          oldPaths
            .filter((oldPath) => Object.hasOwn(redirects, oldPath))
            .map((oldPath): [string, string] => [oldPath, redirects[oldPath] ?? ""]),
        ),
      );
    },
  };
  return { service: createRedirectService({ redirectLookup }), asked };
}

describe("finding where an old address has moved to", () => {
  it("finds the redirect for the exact address", async () => {
    const { service } = lookupOf({ "/tools/lantern-notes-wiki/": "/tools/lanternly" });
    expect(await service.newPathFor("/tools/lantern-notes-wiki/")).toBe("/tools/lanternly");
  });

  it("finds it with or without the trailing slash", async () => {
    const { service } = lookupOf({
      "/tools/lantern-notes-wiki/": "/tools/lanternly",
      "/old-widgets": "/guidance/widgets",
    });
    expect(await service.newPathFor("/tools/lantern-notes-wiki")).toBe("/tools/lanternly");
    expect(await service.newPathFor("/old-widgets/")).toBe("/guidance/widgets");
  });

  it("prefers the exact address to the one with the slash changed", async () => {
    const { service } = lookupOf({ "/about": "/pages/about", "/about/": "/pages/something-else" });
    expect(await service.newPathFor("/about")).toBe("/pages/about");
    expect(await service.newPathFor("/about/")).toBe("/pages/something-else");
  });

  it("finds nothing for an address with no redirect", async () => {
    const { service } = lookupOf({ "/about.html": "/pages/about" });
    expect(await service.newPathFor("/missing.html")).toBeUndefined();
  });

  it("looks up an encoded address as it was requested", async () => {
    const { service } = lookupOf({ "/tools/caf%C3%A9/": "/tools/cafe" });
    expect(await service.newPathFor("/tools/caf%C3%A9/")).toBe("/tools/cafe");
  });

  it("doesn't look up an address that is too long or isn't a path on this site", async () => {
    const { service, asked } = lookupOf({});
    expect(await service.newPathFor(`/${"a".repeat(3000)}`)).toBeUndefined();
    expect(await service.newPathFor("//elsewhere.example.com/")).toBeUndefined();
    expect(await service.newPathFor("/with space")).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("never sends anyone to another site, even if a stored redirect says to", async () => {
    const { service } = lookupOf({
      "/one.html": "//elsewhere.example.com/",
      "/two.html": "https://elsewhere.example.com/",
      "/three.html": "/\\elsewhere.example.com",
      "/four.html": "javascript:alert(1)",
    });
    for (const path of ["/one.html", "/two.html", "/three.html", "/four.html"]) {
      expect(await service.newPathFor(path)).toBeUndefined();
    }
  });

  it("never redirects an address to itself", async () => {
    const { service } = lookupOf({ "/whats-new/": "/whats-new", "/loop": "/loop" });
    expect(await service.newPathFor("/whats-new")).toBeUndefined();
    expect(await service.newPathFor("/loop")).toBeUndefined();
  });
});
