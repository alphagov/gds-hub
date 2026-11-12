import { describe, expect, it } from "vitest";
import { presentCapability, presentHome } from "../../src/presenters/capabilities.js";
import { contentsNavigation, UNGROUPED_CAPABILITIES } from "../../src/presenters/contents.js";
import {
  attributeLabel,
  capitalise,
  dateRange,
  emailLink,
  formatDate,
  migrationStatusTag,
  paragraphs,
  safeHref,
  textRows,
  websiteLink,
} from "../../src/presenters/format.js";
import {
  NOT_IN_A_BUSINESS_UNIT,
  presentBusinessUnit,
  presentProductTeamService,
  presentServices,
} from "../../src/presenters/organisation.js";
import {
  accessDetails,
  presentContract,
  presentInstance,
  presentTool,
  presentVendor,
} from "../../src/presenters/tools.js";
import type {
  InstanceRecord,
  InstanceWithOwnership,
  SupplierRecord,
} from "../../src/repositories/index.js";
import { groupCapabilitiesForNavigation } from "../../src/services/catalogue/ordering.js";
import { HOME_PATH, SECTIONS, SERVICE_NAME } from "../../src/site-map.js";
import {
  businessUnitDetail,
  capabilityDetail,
  capabilityRecord,
  groups,
  instanceDetail,
  instanceRecord,
  productTeamServiceDetail,
  serviceDirectory,
  toolDetail,
  toolRecord,
  vendorDetail,
} from "./catalogue-fixtures.js";

const home = { text: "Home", href: HOME_PATH };

function withOwnership(instance: InstanceRecord): InstanceWithOwnership {
  return { ...instance, ownershipLevel: null, targetOwnershipLevel: null };
}

function supplierRecord(id: number, name: string): SupplierRecord {
  const created = new Date("2026-01-01T09:00:00Z");
  return {
    id,
    name,
    url: null,
    accountManagerName: null,
    accountManagerEmail: null,
    supportContact: null,
    notes: null,
    createdAt: created,
    updatedAt: created,
  };
}
const toolsCrumb = { text: SECTIONS.tools.name, href: SECTIONS.tools.path };
const servicesCrumb = { text: SECTIONS.services.name, href: SECTIONS.services.path };

describe("paragraphs", () => {
  it("splits text into paragraphs at blank lines", () => {
    expect(paragraphs("First line\nstill first.\n\n  Second.  \r\n\r\nThird.")).toEqual([
      "First line\nstill first.",
      "Second.",
      "Third.",
    ]);
  });

  it("gives no paragraphs for missing or blank text", () => {
    expect(paragraphs(null)).toEqual([]);
    expect(paragraphs(undefined)).toEqual([]);
    expect(paragraphs(" \n\n \t")).toEqual([]);
  });

  it("keeps markup as plain text for the template to escape", () => {
    expect(paragraphs("<b>bold</b>")).toEqual(["<b>bold</b>"]);
  });
});

describe("safeHref", () => {
  it("allows absolute http and https addresses", () => {
    expect(safeHref("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
    expect(safeHref(" http://example.com ")).toBe("http://example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@example.com",
    "/relative/path",
    "//example.com",
    "not a url",
    "",
  ])("refuses %j", (url: string) => {
    expect(safeHref(url)).toBeUndefined();
  });

  it("refuses a missing address", () => {
    expect(safeHref(null)).toBeUndefined();
  });

  it("gives a website link only for a safe address", () => {
    expect(websiteLink("https://example.com")).toEqual({
      text: "https://example.com",
      href: "https://example.com/",
    });
    expect(websiteLink("javascript:alert(1)")).toBeNull();
  });
});

describe("emailLink", () => {
  it("links a plain email address", () => {
    expect(emailLink(" team@example.com ")).toEqual({
      text: "team@example.com",
      href: "mailto:team@example.com",
    });
  });

  it.each([
    "not an email",
    "team@example",
    "two@at@example.com",
    "team@example.com?cc=someone@example.com",
    'team@example.com"onclick="x',
    "",
  ])("does not link %j", (address: string) => {
    expect(emailLink(address)).toBeNull();
  });

  it("does not link an address longer than email allows", () => {
    expect(emailLink(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("dates", () => {
  it("formats a date in GOV.UK style", () => {
    expect(formatDate("2026-10-01")).toBe("1 October 2026");
    expect(formatDate("2027-03-31")).toBe("31 March 2027");
  });

  it("shows anything that isn't a date as it is stored", () => {
    expect(formatDate("2026-13-01")).toBe("2026-13-01");
    expect(formatDate("soon")).toBe("soon");
    expect(formatDate(null)).toBeUndefined();
  });

  it("describes a date range with one or both ends", () => {
    expect(dateRange("2026-04-01", "2027-03-31")).toBe("1 April 2026 to 31 March 2027");
    expect(dateRange("2026-04-01", null)).toBe("From 1 April 2026");
    expect(dateRange(null, "2027-03-31")).toBe("Until 31 March 2027");
    expect(dateRange(null, null)).toBeUndefined();
  });
});

describe("labels", () => {
  it("capitalises lower-case labels", () => {
    expect(capitalise("directorate")).toBe("Directorate");
    expect(capitalise("  ")).toBeNull();
  });

  it("turns attribute names into labels", () => {
    expect(attributeLabel("scan_schedule")).toBe("Scan schedule");
    expect(attributeLabel("data-retention")).toBe("Data retention");
  });

  it("gives every migration status its own tag", () => {
    expect(migrationStatusTag("not_started")).toEqual({
      text: "Not started",
      classes: "govuk-tag--grey",
    });
    expect(migrationStatusTag("in_progress")).toEqual({ text: "In progress" });
    expect(migrationStatusTag("complete")).toEqual({
      text: "Complete",
      classes: "govuk-tag--green",
    });
    expect(migrationStatusTag("not_applicable")).toEqual({
      text: "Not applicable",
      classes: "govuk-tag--grey",
    });
  });

  it("only makes summary rows for values that have text", () => {
    expect(
      textRows([
        ["Shown", "Value"],
        ["Blank", "  "],
        ["Missing", null],
        ["Unset", undefined],
      ]),
    ).toEqual([{ key: { text: "Shown" }, value: { text: "Value" } }]);
  });
});

describe("contentsNavigation", () => {
  it("lists each visible capability under its group, in navigation order", () => {
    const contents = contentsNavigation(groups);

    expect(contents.label).toBe("Contents");
    expect(contents.groups).toEqual([
      {
        name: "Cartography",
        items: [
          { text: "Globe spinning", href: "/capabilities/globe-spinning", current: false },
          { text: "Map making", href: "/capabilities/map-making", current: false },
        ],
      },
    ]);
  });

  it("marks the capability whose page it is", () => {
    const contents = contentsNavigation(groups, "map-making");

    const current = contents.groups.flatMap((group) => group.items).filter((item) => item.current);
    expect(current.map((item) => item.text)).toEqual(["Map making"]);
  });

  it("names the group of capabilities that have no group", () => {
    const contents = contentsNavigation(
      groupCapabilitiesForNavigation([capabilityRecord({ groupName: null })]),
    );

    expect(contents.groups.map((group) => group.name)).toEqual([UNGROUPED_CAPABILITIES]);
  });
});

describe("home and capability pages", () => {
  it("lists the capability groups on the home page, with the contents", () => {
    const page = presentHome(groups);

    expect(page.title).toBe(SERVICE_NAME);
    expect(page.breadcrumbs).toBeUndefined();
    expect(page.contents?.groups).toHaveLength(1);
    expect(page.groups[0]?.capabilities).toEqual([
      {
        text: "Globe spinning",
        href: "/capabilities/globe-spinning",
        description: "Draw maps of invented places.",
      },
      {
        text: "Map making",
        href: "/capabilities/map-making",
        description: "Draw maps of invented places.",
      },
    ]);
  });

  it("shows a capability's group, plans, tools and who it is provided to", () => {
    const page = presentCapability(
      capabilityDetail({
        capability: capabilityRecord({ comment: "Retire the old maps.\n\nThen make new ones." }),
        provisions: [
          {
            instance: {
              id: 1,
              key: "atlas-maker-main",
              slug: "atlas-maker-main",
              name: "Atlas Maker main workspace",
              isPlaceholder: false,
              notInUse: false,
              tool: { id: 1, key: "atlas-maker", slug: "atlas-maker", name: "Atlas Maker" },
            },
            productTeamService: {
              id: 1,
              key: "mapping-team",
              slug: "mapping-team",
              name: "Mapping Team",
            },
          },
        ],
      }),
      groups,
    );

    expect(page).toMatchObject({
      title: "Map making",
      caption: "Cartography",
      section: "capabilities",
      breadcrumbs: [home, { text: SECTIONS.capabilities.name, href: SECTIONS.capabilities.path }],
      plans: ["Retire the old maps.", "Then make new ones."],
      tools: [{ text: "Atlas Maker", href: "/tools/atlas-maker", description: "Makes atlases." }],
      provisions: [
        {
          productTeamService: { text: "Mapping Team", href: "/services/mapping-team" },
          instance: { text: "Atlas Maker main workspace", href: "/instances/atlas-maker-main" },
        },
      ],
    });
    const current = page.contents?.groups
      .flatMap((group) => group.items)
      .find((item) => item.current);
    expect(current?.text).toBe("Map making");
  });
});

describe("tool page", () => {
  it("shows the tool's type, vendor, suppliers and capabilities", () => {
    const page = presentTool(
      toolDetail({
        tool: toolRecord({ vendorId: 1 }),
        vendor: vendorDetail().vendor,
        suppliers: [supplierRecord(1, "Reseller One"), supplierRecord(2, "Reseller Two")],
      }),
      groups,
    );

    expect(page).toMatchObject({
      title: "Atlas Maker",
      caption: "Engineering tool",
      section: "tools",
      breadcrumbs: [home, toolsCrumb],
      vendor: { text: "Compass Co", href: "/vendors/compass-co" },
      suppliers: "Reseller One, Reseller Two",
      capabilities: [{ text: "Map making", href: "/capabilities/map-making" }],
    });
  });

  it("shows how to get access to each instance, with its migration status", () => {
    const page = presentTool(toolDetail(), groups);

    expect(page.instances).toEqual([
      {
        heading: { text: "Atlas Maker main workspace", href: "/instances/atlas-maker-main" },
        description: ["The shared workspace."],
        website: { text: "https://atlas.example.com", href: "https://atlas.example.com/" },
        migrationStatus: { text: "Not started", classes: "govuk-tag--grey" },
        notInUse: null,
        details: [
          { summary: "Getting access", paragraphs: ["Ask in the #atlas channel."] },
          { summary: "Authentication", paragraphs: ["Sign in with an invented provider."] },
        ],
      },
    ]);
  });

  it("does not link a placeholder instance to a page of its own", () => {
    const page = presentTool(
      toolDetail({ instances: [withOwnership(instanceRecord({ isPlaceholder: true }))] }),
      groups,
    );

    expect(page.instances[0]?.heading).toBeNull();
  });

  it("marks an instance that is not in use", () => {
    const page = presentTool(
      toolDetail({ instances: [withOwnership(instanceRecord({ notInUse: true }))] }),
      groups,
    );

    expect(page.instances[0]?.notInUse).toEqual({ text: "Not in use", classes: "govuk-tag--grey" });
  });

  it("does not link an instance's website unless it is an http or https address", () => {
    const unsafe = instanceRecord({ url: "javascript:alert(1)" });
    const page = presentTool(toolDetail({ instances: [withOwnership(unsafe)] }), groups);

    expect(page.instances[0]?.website).toBeNull();
  });
});

describe("access details", () => {
  it("shows the four access fields in order, leaving out empty ones", () => {
    const details = accessDetails(
      instanceRecord({
        gettingAccess: null,
        authentication: "Single sign-on.",
        userProvisioning: "Accounts are made on first sign-in.",
        escalationContact:
          "Page the invented on-call rota.\n\nOut of hours, email oncall@example.com.",
      }),
    );

    expect(details).toEqual([
      { summary: "Authentication", paragraphs: ["Single sign-on."] },
      { summary: "User provisioning", paragraphs: ["Accounts are made on first sign-in."] },
      {
        summary: "Escalation contact",
        paragraphs: ["Page the invented on-call rota.", "Out of hours, email oncall@example.com."],
      },
    ]);
  });

  it("is empty when no access information is recorded", () => {
    expect(accessDetails(instanceRecord({ gettingAccess: " ", authentication: null }))).toEqual([]);
  });
});

describe("instance page", () => {
  it("belongs to the Tools section, with breadcrumbs back to its tool", () => {
    const page = presentInstance(instanceDetail(), groups);

    expect(page).toMatchObject({
      title: "Atlas Maker main workspace",
      caption: "Atlas Maker",
      section: "tools",
      breadcrumbs: [home, toolsCrumb, { text: "Atlas Maker", href: "/tools/atlas-maker" }],
      tool: { text: "Atlas Maker", href: "/tools/atlas-maker" },
    });
    expect(page.access.heading).toBeNull();
  });

  it("shows the instance's other details and its extra attributes in name order", () => {
    const page = presentInstance(
      instanceDetail({
        instance: instanceRecord({
          supportedByGdsSoftwareServiceDesk: true,
          migrationDate: "2026-06-30",
          extraAttributes: { scan_schedule: "Nightly", alpha_setting: "On" },
        }),
        ownershipLevel: { id: 1, key: "documented", name: "Documented" },
      }),
      groups,
    );

    expect(page.rows).toEqual([
      { key: { text: "Migration date" }, value: { text: "30 June 2026" } },
      { key: { text: "Supported by the GDS software service desk" }, value: { text: "Yes" } },
      { key: { text: "Ownership level" }, value: { text: "Documented" } },
    ]);
    expect(page.extraAttributes).toEqual([
      { key: { text: "Alpha setting" }, value: { text: "On" } },
      { key: { text: "Scan schedule" }, value: { text: "Nightly" } },
    ]);
  });
});

describe("contracts", () => {
  it("names the supplier and shows only the recorded fields", () => {
    const contract = presentContract({
      id: 1,
      toolId: 1,
      supplierId: 1,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      licenseType: "Per seat",
      licenseTerms: null,
      procurementRoute: null,
      cost: "£100 a year",
      costModel: null,
      commercials: null,
      dataProtectionAndSecurity: null,
      operationalPolicy: null,
      totalUsers: null,
      renewalNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      supplier: { id: 1, name: "Reseller One", url: null },
    });

    expect(contract).toEqual({
      title: "Contract with Reseller One",
      rows: [
        { key: { text: "Dates" }, value: { text: "1 April 2026 to 31 March 2027" } },
        { key: { text: "Licence type" }, value: { text: "Per seat" } },
        { key: { text: "Cost" }, value: { text: "£100 a year" } },
      ],
    });
  });
});

describe("vendor page", () => {
  it("belongs to the Tools section and lists the vendor's contacts", () => {
    const page = presentVendor(vendorDetail(), groups);

    expect(page).toMatchObject({
      title: "Compass Co",
      section: "tools",
      breadcrumbs: [home, toolsCrumb],
      website: { text: "https://compass.example.com", href: "https://compass.example.com/" },
      rows: [{ key: { text: "Support contact" }, value: { text: "help@compass.example.com" } }],
    });
  });
});

describe("services pages", () => {
  it("groups products, teams and services by business unit, then lists those in none", () => {
    const page = presentServices(
      {
        businessUnits: [
          ...serviceDirectory.businessUnits,
          { id: 9, key: "empty-unit", name: "Empty unit", productTeamServices: [] },
        ],
        unassigned: [{ id: 5, key: "loners", slug: "loners", name: "Loners", purpose: null }],
      },
      groups,
    );

    expect(page.groups).toEqual([
      {
        heading: "Exploration",
        href: "/business-units/exploration",
        items: [
          { text: "Mapping Team", href: "/services/mapping-team", description: "Draws maps" },
        ],
      },
      {
        heading: NOT_IN_A_BUSINESS_UNIT,
        href: null,
        items: [{ text: "Loners", href: "/services/loners" }],
      },
    ]);
  });

  it("shows a team's contacts as links", () => {
    const page = presentProductTeamService(productTeamServiceDetail(), groups);

    expect(page).toMatchObject({
      title: "Mapping Team",
      section: "services",
      breadcrumbs: [home, servicesCrumb],
      purpose: "Draws maps of invented places",
      businessUnits: [{ text: "Exploration", href: "/business-units/exploration" }],
      slackChannel: { text: "#mapping", href: "https://example.slack.com/archives/C0000000009" },
      email: { text: "mapping@example.com", href: "mailto:mapping@example.com" },
      githubOrganisations: [{ text: "example-maps", href: "https://github.com/example-maps" }],
      rows: [{ key: { text: "Last reviewed" }, value: { text: "1 October 2026" } }],
    });
  });

  it("shows an email that isn't a plain address as text, not a link", () => {
    const detail = productTeamServiceDetail();
    const page = presentProductTeamService(
      {
        ...detail,
        productTeamService: { ...detail.productTeamService, teamEmailAddress: "Ask on Slack" },
      },
      groups,
    );

    expect(page.email).toBeNull();
    expect(page.rows[0]).toEqual({ key: { text: "Email" }, value: { text: "Ask on Slack" } });
  });

  it("links a team's placeholder instance to its tool", () => {
    const page = presentProductTeamService(
      productTeamServiceDetail({
        instances: [
          {
            id: 7,
            key: "atlas-maker",
            slug: "atlas-maker",
            name: "Atlas Maker",
            isPlaceholder: true,
            notInUse: false,
            tool: { id: 1, key: "atlas-maker", slug: "atlas-maker", name: "Atlas Maker" },
          },
        ],
      }),
      groups,
    );

    expect(page.instances).toEqual([{ text: "Atlas Maker", href: "/tools/atlas-maker" }]);
  });

  it("puts a business unit's parent in its breadcrumbs", () => {
    const parent = { id: 1, key: "headquarters", name: "Headquarters" };
    const page = presentBusinessUnit(businessUnitDetail({ parent }), groups);

    expect(page).toMatchObject({
      title: "Exploration",
      caption: "Directorate",
      section: "services",
      breadcrumbs: [
        home,
        servicesCrumb,
        { text: "Headquarters", href: "/business-units/headquarters" },
      ],
      parent: { text: "Headquarters", href: "/business-units/headquarters" },
      rows: [{ key: { text: "Lead" }, value: { text: "Pat Example" } }],
    });
  });
});
