import { describe, expect, it } from "vitest";
import {
  normaliseOldPath,
  oldPathOf,
  redirectOldPath,
  rewriteLink,
  type LinkContext,
} from "../../../src/migration/links.js";

const context: LinkContext = {
  pagePath: "/engineering/widgets/",
  siteOrigins: ["https://hub.example.com"],
  assetBasePath: "/hub-assets",
  pathMap: new Map([
    ["/engineering/widgets/", "/guidance/widgets"],
    ["/engineering/widgets/setup.html", "/guidance/widgets-setup"],
    ["/tools/kettle-board/", "/tools/kettle-board"],
    ["/InfoSec/device-policy.html", "/policies/device-policy"],
  ]),
};

describe("old paths", () => {
  it.each([
    ["tools/kettle-board/index.html", "/tools/kettle-board/"],
    ["engineering/widgets/setup.html", "/engineering/widgets/setup.html"],
    ["index.html", "/"],
  ])("gives the built file %s the address %s", (builtPath, oldPath) => {
    expect(oldPathOf(builtPath)).toBe(oldPath);
  });

  it.each([
    ["/images/../images/widgets/diagram.svg", "/images/widgets/diagram.svg"],
    ["/tools/kettle-board/index.html", "/tools/kettle-board/"],
    ["/engineering/./widgets/", "/engineering/widgets/"],
    ["/index.html", "/"],
  ])("normalises %s to %s", (path, normalised) => {
    expect(normaliseOldPath(path)).toBe(normalised);
  });
});

describe("link rewriting", () => {
  it("rewrites a link to another migrated page", () => {
    expect(rewriteLink("/tools/kettle-board/", context)).toEqual({
      kind: "page",
      href: "/tools/kettle-board",
    });
  });

  it("resolves a relative link against the page it is on", () => {
    expect(rewriteLink("setup.html", context).href).toBe("/guidance/widgets-setup");
    expect(rewriteLink("../widgets/setup.html", context).href).toBe("/guidance/widgets-setup");
    expect(rewriteLink("./", context).href).toBe("/guidance/widgets");
  });

  it("keeps the fragment", () => {
    expect(rewriteLink("/InfoSec/device-policy.html#scope", context).href).toBe(
      "/policies/device-policy#scope",
    );
  });

  it("finds a page linked without its trailing slash or with index.html", () => {
    expect(rewriteLink("/tools/kettle-board", context).href).toBe("/tools/kettle-board");
    expect(rewriteLink("/tools/kettle-board/index.html", context).href).toBe("/tools/kettle-board");
  });

  it("treats absolute links to the old site as internal", () => {
    expect(rewriteLink("https://hub.example.com/InfoSec/device-policy.html", context)).toEqual({
      kind: "page",
      href: "/policies/device-policy",
    });
  });

  it.each([
    "https://www.example.org/widgets",
    "//cdn.example.org/file.js",
    "mailto:widgets@example.com",
    "tel:+440000000000",
    "#set-up",
    "",
  ])("leaves %j alone", (href) => {
    expect(rewriteLink(href, context)).toEqual({ kind: "unchanged", href });
  });

  it("flags a link to an internal page that wasn't found, and leaves it as it was", () => {
    const result = rewriteLink("/engineering/missing-page.html", context);
    expect(result.kind).toBe("unchanged");
    expect(result.href).toBe("/engineering/missing-page.html");
    expect(result.warning).toMatchObject({ code: "unknown_internal_link", manualReview: true });
    expect(result.warning?.message).toContain("/engineering/missing-page.html");
  });

  it.each(["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html;base64,PHA+"])(
    "flags %j for manual review, and leaves it for rendering to remove",
    (href) => {
      const result = rewriteLink(href, context);
      expect(result.kind).toBe("unchanged");
      expect(result.warning).toMatchObject({ code: "unsafe_link", manualReview: true });
      expect(result.warning?.message).not.toContain("alert");
    },
  );

  it("points images and downloads at the asset path and reports the old path", () => {
    expect(rewriteLink("/images/../images/widgets/diagram.svg", context)).toEqual({
      kind: "asset",
      href: "/hub-assets/images/widgets/diagram.svg",
      assetPath: "/images/widgets/diagram.svg",
    });
    expect(rewriteLink("files/handbook.pdf", context)).toEqual({
      kind: "asset",
      href: "/hub-assets/engineering/widgets/files/handbook.pdf",
      assetPath: "/engineering/widgets/files/handbook.pdf",
    });
  });
});

describe("redirect targets", () => {
  const origins = ["https://hub.example.com"];

  it.each([
    ["engineering/widgets/", "/old-widgets.html", "/engineering/widgets/"],
    ["../setup.html", "/engineering/widgets/old.html", "/engineering/setup.html"],
    ["https://hub.example.com/tools/index.html", "/old-tools.html", "/tools/"],
  ])("resolves %s on %s to %s", (target, pagePath, oldPath) => {
    expect(redirectOldPath(target, pagePath, origins)).toBe(oldPath);
  });

  it.each([
    "https://other.example.com/tools/",
    "//other.example.com/tools/",
    "javascript:alert(1)",
  ])("gives nothing for %s, which isn't on this site", (target) => {
    expect(redirectOldPath(target, "/old-tools.html", origins)).toBeUndefined();
  });
});
