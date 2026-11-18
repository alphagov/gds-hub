import { describe, expect, it } from "vitest";
import {
  contentPageTarget,
  parameterize,
  toolGroupName,
} from "../../../src/migration/hub-structure.js";

describe("parameterize, as the current Hub makes URL slugs from names", () => {
  it.each([
    ["Lantern Notes & Wiki", "lantern-notes-wiki"],
    ["Café Déjà Vu (Example) — Team", "cafe-deja-vu-example-team"],
    ["Example.Org, Widgets and More", "example-org-widgets-and-more"],
    ["snake_case Name", "snake_case-name"],
    ["  --Leading and trailing--  ", "leading-and-trailing"],
    ["UPPER case", "upper-case"],
  ])("turns %j into %j", (name, slug) => {
    expect(parameterize(name)).toBe(slug);
  });
});

describe("tool group names", () => {
  it.each([
    ["Collaboration", "Collaboration Tools"],
    ["Operations Tools", "Operations Tools"],
    ["Build tool", "Build Tools"],
    ["Other things", "Other Tools"],
    ["", "Other Tools"],
    [undefined, "Other Tools"],
  ])("formats the capability group %j as %j", (group, name) => {
    expect(toolGroupName(group)).toBe(name);
  });
});

describe("content page targets", () => {
  it.each([
    ["InfoSec/device-policy.html", "policy", "device-policy", "/policies/device-policy"],
    ["InfoSec/index.html", "policy", "infosec", "/policies/infosec"],
    ["engineering/widgets/index.html", "service_guide", "widgets", "/guidance/widgets"],
    ["engineering/widgets/setup.html", "service_guide", "widgets-setup", "/guidance/widgets-setup"],
    [
      "service_desk_manual/raising-a-ticket.html",
      "guidance",
      "raising-a-ticket",
      "/guidance/raising-a-ticket",
    ],
    [
      "service_desk_manual/index.html",
      "guidance",
      "service-desk-manual",
      "/guidance/service-desk-manual",
    ],
    ["tools/kettle-guide.html", "guidance", "kettle-guide", "/guidance/kettle-guide"],
    [
      "whats-new/trying-out-paper-boats.html",
      "whats_new",
      "trying-out-paper-boats",
      "/whats-new/trying-out-paper-boats",
    ],
    ["support.html", "general", "support", "/pages/support"],
    [
      "Team_Pages/Example Page.html",
      "general",
      "team-pages-example-page",
      "/pages/team-pages-example-page",
    ],
  ])("maps %s to a %s page with slug %s at %s", (builtPath, pageType, slug, newPath) => {
    expect(contentPageTarget(builtPath)).toEqual({ pageType, slug, newPath });
  });
});
