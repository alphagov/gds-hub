// Synthetic seed data for local development and CI. Every organisation, tool,
// team, person and address here is invented. Never add real Hub content.

import type {
  businessUnits,
  capabilities,
  contracts,
  instances,
  ownershipLevels,
  pages,
  productTeamServices,
  suppliers,
  tools,
  vendors,
} from "../schema/index.js";

type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

/** Fields set by the database or resolved from a key reference by the seed. */
type Managed = "id" | "createdAt" | "updatedAt";

/** Who the seed's audit entries are attributed to. */
export const SEED_ACTOR = { name: "Seed script", subject: "system:seed" } as const;

export const seedOwnershipLevels: Omit<Insert<typeof ownershipLevels>, Managed>[] = [
  {
    key: "undocumented",
    name: "Undocumented",
    definition: "Nobody has written down who owns the tool or how it's run.",
    description: "Tools start here until a team takes responsibility for them.",
    targetState: "A named team has documented how the tool is used.",
    weight: 0,
  },
  {
    key: "documented",
    name: "Documented",
    definition: "How the tool is used is written down, but no team owns it.",
    description: "Someone has recorded how to get access and who to ask.",
    targetState: "A team agrees to own the tool.",
    weight: 1,
  },
  {
    key: "team-owned",
    name: "Team owned",
    definition: "A named team owns the tool and keeps its documentation current.",
    description: "The owning team handles access requests and changes.",
    targetState: "The tool has an agreed level of support.",
    weight: 2,
  },
  {
    key: "supported",
    name: "Supported",
    definition: "The tool has agreed support hours and an escalation route.",
    description: "Users know how to get help and how quickly to expect it.",
    targetState: "The tool is run as a managed service.",
    weight: 3,
  },
  {
    key: "managed-service",
    name: "Managed service",
    definition: "The tool is run as a service with monitoring and on-call cover.",
    description: "Changes are planned, communicated and reviewed.",
    targetState: "Keep the service at this level.",
    weight: 4,
  },
];

export const seedVendors: Omit<Insert<typeof vendors>, Managed>[] = [
  {
    slug: "kestrel-cloud",
    name: "Kestrel Cloud Ltd",
    description: "Makes developer tooling for build and deployment pipelines.",
    url: "https://kestrel.example.com",
    supportContact: "support@kestrel.example.com",
    dataProtectionContact: "privacy@kestrel.example.com",
  },
  {
    slug: "brightfield-systems",
    name: "Brightfield Systems",
    description: "Makes collaboration and messaging software.",
    url: "https://brightfield.example.com",
    supportContact: "help@brightfield.example.com",
    dataProtectionContact: "dpo@brightfield.example.com",
  },
  {
    slug: "openpath-foundation",
    name: "Openpath Foundation",
    description: "A non-profit that maintains open source quality tools.",
    url: "https://openpath.example.org",
    supportContact: "Community forum at https://openpath.example.org/forum",
  },
];

export const seedSuppliers: Omit<Insert<typeof suppliers>, Managed>[] = [
  {
    name: "Meridian Digital Supply Ltd",
    url: "https://meridian.example.com",
    accountManagerName: "Sam Example",
    accountManagerEmail: "sam.example@meridian.example.com",
    supportContact: "accounts@meridian.example.com",
    notes: "Reseller on the software framework.",
  },
  {
    name: "Brightfield Systems",
    url: "https://brightfield.example.com",
    accountManagerName: "Jo Sample",
    accountManagerEmail: "jo.sample@brightfield.example.com",
    supportContact: "billing@brightfield.example.com",
  },
];

export type SeedTool = Omit<Insert<typeof tools>, Managed | "vendorId" | "slug"> & {
  vendor?: string;
  suppliers?: string[];
};

export const seedTools: SeedTool[] = [
  {
    key: "pipeline-pilot",
    name: "Pipeline Pilot",
    description: "Builds, tests and deploys code changes automatically.",
    engineeringOrBusinessTool: "engineering",
    vendor: "Kestrel Cloud Ltd",
    suppliers: ["Meridian Digital Supply Ltd"],
  },
  {
    key: "sentinel-scan",
    name: "Sentinel Scan",
    description: "Scans repositories for vulnerable dependencies and leaked secrets.",
    engineeringOrBusinessTool: "engineering",
    vendor: "Kestrel Cloud Ltd",
    suppliers: ["Meridian Digital Supply Ltd"],
  },
  {
    key: "pagewatch",
    name: "Pagewatch",
    description: "Alerts on-call engineers when a service has a problem.",
    engineeringOrBusinessTool: "engineering",
  },
  {
    key: "chatterbox",
    name: "Chatterbox",
    description: "Instant messaging for teams, with channels and huddles.",
    engineeringOrBusinessTool: "business",
    vendor: "Brightfield Systems",
    suppliers: ["Brightfield Systems"],
  },
  {
    key: "canvasly",
    name: "Canvasly",
    description: "An online whiteboard for workshops and service mapping.",
    engineeringOrBusinessTool: "business",
    vendor: "Brightfield Systems",
    suppliers: ["Brightfield Systems", "Meridian Digital Supply Ltd"],
  },
  {
    key: "contrast-lens",
    name: "Contrast Lens",
    description: "Checks web pages for common accessibility problems.",
    engineeringOrBusinessTool: "engineering",
    vendor: "Openpath Foundation",
  },
  {
    key: "ledgerly",
    name: "Ledgerly",
    description: "Tracks licence spend and renewal dates.",
    engineeringOrBusinessTool: "business",
  },
];

export type SeedContract = Omit<Insert<typeof contracts>, Managed | "toolId" | "supplierId"> & {
  ref: string;
  tool: string;
  supplier: string;
};

export const seedContracts: SeedContract[] = [
  {
    ref: "pipeline-pilot-2026",
    tool: "pipeline-pilot",
    supplier: "Meridian Digital Supply Ltd",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    licenseType: "Per seat",
    licenseTerms: "Annual subscription, 150 seats.",
    procurementRoute: "Software framework call-off",
    cost: "£18,000 a year",
    costModel: "Per user per month, billed annually.",
    totalUsers: "142",
    operationalPolicy: "Only use for code that's in a GDS organisation.",
    dataProtectionAndSecurity: "Data is held in the UK. Security assessment completed.",
  },
  {
    ref: "chatterbox-2025",
    tool: "chatterbox",
    supplier: "Brightfield Systems",
    startDate: "2025-10-01",
    endDate: "2027-09-30",
    licenseType: "Enterprise",
    licenseTerms: "Two-year enterprise agreement.",
    cost: "£96,000 over two years",
    costModel: "Flat fee for unlimited users.",
    totalUsers: "Around 1,200",
    renewalNotes: "Review usage 3 months before renewal.",
  },
  {
    ref: "canvasly-2026",
    tool: "canvasly",
    supplier: "Meridian Digital Supply Ltd",
    startDate: "2026-01-15",
    endDate: "2027-01-14",
    licenseType: "Per seat",
    cost: "£6,500 a year",
    totalUsers: "60",
  },
];

export type SeedInstance = Omit<
  Insert<typeof instances>,
  Managed | "slug" | "toolId" | "contractId" | "ownershipLevelId" | "targetOwnershipLevelId"
> & {
  tool: string;
  contract?: string;
  ownershipLevel?: string;
  targetOwnershipLevel?: string;
};

export const seedInstances: SeedInstance[] = [
  {
    key: "pipeline-pilot-gds",
    name: "Pipeline Pilot (GDS)",
    tool: "pipeline-pilot",
    contract: "pipeline-pilot-2026",
    url: "https://gds.pipeline-pilot.example.com",
    description: "The shared Pipeline Pilot workspace for GDS teams.",
    gettingAccess: "Ask in the #build-tools channel and give your team name.",
    management: "Managed by the Build Tools Team.",
    authentication: "Sign in with Google",
    userProvisioning: "Accounts are created when you first sign in.",
    support: "Build Tools Team, 9am to 5pm on working days.",
    migrationStatus: "complete",
    migrationDate: "2026-06-30",
    ownershipLevel: "managed-service",
    targetOwnershipLevel: "managed-service",
    lastReviewedAt: "2026-10-01",
  },
  {
    key: "sentinel-scan-gds",
    name: "Sentinel Scan (GDS)",
    tool: "sentinel-scan",
    url: "https://app.sentinel-scan.example.com/gds",
    description: "Scans every repository in the GDS organisations each night.",
    gettingAccess: "You get access automatically through your repository permissions.",
    authentication: "Single sign-on",
    migrationStatus: "in_progress",
    ownershipLevel: "team-owned",
    targetOwnershipLevel: "supported",
    extraAttributes: { scan_schedule: "Nightly at 2am", retention: "90 days" },
    lastReviewedAt: "2026-05-12",
  },
  {
    key: "pagewatch-production",
    name: "Pagewatch production account",
    tool: "pagewatch",
    url: "https://gds.pagewatch.example.com",
    description: "Pages on-call engineers for production incidents.",
    gettingAccess: "Your team lead adds you to the right escalation policy.",
    escalationContact: "Out of hours, page the platform on-call rota.",
    ownershipLevel: "supported",
    targetOwnershipLevel: "managed-service",
    lastReviewedAt: "2026-09-18",
  },
  {
    key: "chatterbox-workspace",
    name: "Chatterbox workspace",
    tool: "chatterbox",
    contract: "chatterbox-2025",
    url: "https://gds.chatterbox.example.com",
    description: "The main messaging workspace for GDS staff.",
    gettingAccess: "Request access through the software service desk.",
    supportedByGdsSoftwareServiceDesk: true,
    authentication: "Sign in with Google",
    migrationStatus: "complete",
    migrationDate: "2026-03-14",
    ownershipLevel: "managed-service",
    targetOwnershipLevel: "managed-service",
    lastReviewedAt: "2026-08-20",
  },
  {
    key: "canvasly-team-boards",
    name: "Canvasly team boards",
    tool: "canvasly",
    contract: "canvasly-2026",
    url: "https://canvasly.example.com/gds",
    description: "Whiteboards for workshops, retros and service maps.",
    gettingAccess: "Request a licence through the software service desk.",
    supportedByGdsSoftwareServiceDesk: true,
    ownershipLevel: "documented",
    targetOwnershipLevel: "team-owned",
    lastReviewedAt: "2026-02-03",
  },
  {
    key: "contrast-lens",
    name: "Contrast Lens",
    tool: "contrast-lens",
    description: "Contrast Lens has no shared instance. Install the browser extension.",
    gettingAccess: "Install the browser extension. No account is needed.",
    isPlaceholder: true,
    ownershipLevel: "documented",
    targetOwnershipLevel: "documented",
  },
  {
    key: "ledgerly",
    name: "Ledgerly",
    tool: "ledgerly",
    description: "No longer used. Licence spend is tracked in the finance system.",
    isPlaceholder: true,
    notInUse: true,
    ownershipLevel: "undocumented",
  },
];

export type SeedCapability = Omit<Insert<typeof capabilities>, Managed> & { tools: string[] };

// Weights set the navigation order, which deliberately differs from name order
// in places. Accessibility testing has no weight, so its group comes last.
// Legacy build servers is hidden from navigation but its page still works.
export const seedCapabilities: SeedCapability[] = [
  {
    key: "continuous-integration",
    name: "Continuous integration",
    groupName: "Delivery",
    description: "Build and test every change automatically.",
    comment: "We plan to retire older build servers by March 2027.",
    weight: 10,
    tools: ["pipeline-pilot"],
  },
  {
    key: "legacy-build-servers",
    name: "Legacy build servers",
    groupName: "Delivery",
    description: "Older build servers that are being retired. Use continuous integration instead.",
    weight: 11,
    hideInNavigation: true,
    tools: [],
  },
  {
    key: "dependency-scanning",
    name: "Dependency scanning",
    groupName: "Security",
    description: "Find vulnerable libraries before they reach production.",
    weight: 20,
    tools: ["sentinel-scan"],
  },
  {
    key: "incident-alerting",
    name: "Incident alerting",
    groupName: "Operations",
    description: "Tell the right people quickly when a service has a problem.",
    weight: 30,
    tools: ["pagewatch", "chatterbox"],
  },
  {
    key: "team-messaging",
    name: "Team messaging",
    groupName: "Collaboration",
    description: "Talk to colleagues in channels and direct messages.",
    weight: 40,
    tools: ["chatterbox"],
  },
  {
    key: "online-whiteboards",
    name: "Online whiteboards",
    groupName: "Collaboration",
    description: "Run workshops and map services together.",
    weight: 41,
    tools: ["canvasly"],
  },
  {
    key: "accessibility-testing",
    name: "Accessibility testing",
    groupName: "Quality",
    description: "Check that services work for everyone, including disabled people.",
    comment: "Automated checks only find some problems. Test with real users too.",
    tools: ["contrast-lens"],
  },
];

export type SeedProductTeamService = Omit<Insert<typeof productTeamServices>, Managed | "slug"> & {
  uses: string[];
};

export const seedProductTeamServices: SeedProductTeamService[] = [
  {
    key: "build-tools-team",
    name: "Build Tools Team",
    purpose: "runs the shared build and deployment tooling",
    slackChannel: "https://example.slack.com/archives/C0000000001",
    slackChannelName: "build-tools",
    teamEmailAddress: "build-tools@example.com",
    ghOrgs: ["example-gds"],
    escalationContact: "Raise a ticket, or message #build-tools for urgent issues.",
    lastReviewedAt: "2026-09-01",
    uses: ["pipeline-pilot-gds", "sentinel-scan-gds", "chatterbox-workspace"],
  },
  {
    key: "incident-response-team",
    name: "Incident Response Team",
    purpose: "coordinates the response to major incidents",
    slackChannel: "https://example.slack.com/archives/C0000000002",
    slackChannelName: "incident-response",
    teamEmailAddress: "incident-response@example.com",
    ghOrgs: ["example-gds"],
    escalationContact: "Page the incident manager on call through Pagewatch.",
    lastReviewedAt: "2026-04-22",
    uses: ["pagewatch-production", "chatterbox-workspace"],
  },
  {
    key: "service-directory",
    name: "Service Directory",
    purpose: "helps people find and compare government digital services",
    teamEmailAddress: "service-directory@example.com",
    ghOrgs: ["example-gds", "example-labs"],
    lastReviewedAt: "2026-10-15",
    // Listed before Content Design Community in Public Services, despite the name order.
    weight: 1,
    uses: ["pipeline-pilot-gds", "contrast-lens", "canvasly-team-boards"],
  },
  {
    key: "content-design-community",
    name: "Content Design Community",
    purpose: "brings content designers together to share practice",
    slackChannel: "https://example.slack.com/archives/C0000000003",
    slackChannelName: "content-community",
    lastReviewedAt: "2025-12-01",
    weight: 2,
    uses: ["canvasly-team-boards", "chatterbox-workspace"],
  },
  {
    key: "data-insights-service",
    name: "Data Insights Service",
    purpose: "produces reports on how services are used",
    teamEmailAddress: "data-insights@example.com",
    ghOrgs: ["example-labs"],
    lastReviewedAt: "2026-07-07",
    uses: [],
  },
];

/** Which capability an instance provides to which team. */
export const seedInstanceCapabilities: {
  instance: string;
  capability: string;
  productTeamService: string;
}[] = [
  {
    instance: "pipeline-pilot-gds",
    capability: "continuous-integration",
    productTeamService: "build-tools-team",
  },
  {
    instance: "sentinel-scan-gds",
    capability: "dependency-scanning",
    productTeamService: "build-tools-team",
  },
  {
    instance: "pagewatch-production",
    capability: "incident-alerting",
    productTeamService: "incident-response-team",
  },
  {
    instance: "contrast-lens",
    capability: "accessibility-testing",
    productTeamService: "service-directory",
  },
];

export type SeedBusinessUnit = Omit<Insert<typeof businessUnits>, Managed | "parentId"> & {
  parent?: string;
  operates: string[];
};

// Parents come before their children.
export const seedBusinessUnits: SeedBusinessUnit[] = [
  {
    key: "digital-platforms",
    name: "Digital Platforms",
    level: "directorate",
    description: "Builds and runs shared platforms used across government.",
    lead: "Alex Example",
    escalationContact: "Contact the directorate office at platforms@example.com.",
    operates: ["incident-response-team"],
  },
  {
    key: "developer-experience",
    name: "Developer Experience",
    level: "group",
    description: "Makes it easier for engineers to build and ship services.",
    lead: "Riley Placeholder",
    parent: "digital-platforms",
    operates: ["build-tools-team"],
  },
  {
    key: "public-services",
    name: "Public Services",
    level: "directorate",
    description: "Designs services that help people find what they need.",
    lead: "Morgan Sample",
    operates: ["service-directory", "content-design-community"],
  },
  {
    key: "strategy-and-insight",
    name: "Strategy and Insight",
    level: "directorate",
    description: "Uses data and research to shape priorities.",
    lead: "Jordan Fictional",
    operates: ["data-insights-service"],
  },
];

export type SeedPage = Omit<Insert<typeof pages>, Managed | "productTeamServiceId"> & {
  /** Key of the product, team or service that owns the page. */
  productTeamService?: string;
};

export const seedPages: SeedPage[] = [
  {
    slug: "about",
    pageType: "general",
    title: "About the Hub",
    summary: "What the Hub is for and how to suggest a change.",
    bodyMarkdown:
      "## What the Hub is for\n\nThe Hub tells you which tools you can use and how to get access.\n\n## Suggest a change\n\nUse the edit link on any page.",
    ownerName: "Hub Content Team",
    ownerContact: "hub-content@example.com",
    lastReviewedAt: "2026-10-01",
  },
  {
    slug: "software-approval",
    pageType: "policy",
    title: "Software approval policy",
    summary: "How to get a new tool approved before you use it.",
    bodyMarkdown:
      "## Before you start\n\nCheck the Hub to see if an approved tool already does what you need.\n\n## How to apply\n\n1. Complete a security assessment.\n2. Get approval from your head of profession.\n3. Ask the software service desk to buy the licence.",
    ownerName: "Information Security",
    ownerContact: "infosec@example.com",
    lastReviewedAt: "2026-07-15",
  },
  {
    slug: "data-retention-for-collaboration-tools",
    pageType: "policy",
    title: "Data retention for collaboration tools",
    summary: "How long messages, boards and files are kept.",
    bodyMarkdown:
      "Messages are kept for 2 years. Whiteboards that nobody has opened for 12 months are archived.",
    ownerName: "Information Security",
    ownerContact: "infosec@example.com",
    lastReviewedAt: "2026-03-02",
  },
  {
    slug: "setting-up-a-build-pipeline",
    pageType: "service_guide",
    title: "Setting up a build pipeline",
    summary: "Connect a repository to Pipeline Pilot and run your first build.",
    bodyMarkdown:
      "## Connect your repository\n\nAdd the Pipeline Pilot app to your repository.\n\n## Add a pipeline file\n\nCommit a `pipeline.yml` file to the root of your repository.",
    ownerName: "Build Tools Team",
    ownerContact: "#build-tools on Chatterbox",
    productTeamService: "build-tools-team",
    lastReviewedAt: "2026-09-10",
  },
  {
    slug: "choosing-a-collaboration-tool",
    pageType: "guidance",
    title: "Choosing a collaboration tool",
    summary: "Which approved tool to use for messaging, whiteboards and documents.",
    bodyMarkdown:
      "Use Chatterbox for messages and Canvasly for workshops. Check the tools list before asking for something new.",
    ownerName: "Hub Content Team",
    ownerContact: "hub-content@example.com",
    lastReviewedAt: "2026-06-01",
  },
  {
    slug: "new-online-whiteboard-licences",
    pageType: "whats_new",
    title: "New online whiteboard licences",
    summary: "You can now request a Canvasly licence through the service desk.",
    bodyMarkdown:
      "Canvasly licences are now available to every team. Request one through the software service desk.",
    ownerName: "Hub Content Team",
    publishedAt: new Date("2026-10-20T09:00:00Z"),
  },
  {
    slug: "on-call-handbook",
    pageType: "service_guide",
    status: "draft",
    title: "On-call handbook",
    summary: "A draft guide to being on call. Not published yet.",
    bodyMarkdown: "This guide is being written.",
    ownerName: "Incident Response Team",
    productTeamService: "incident-response-team",
  },
];
