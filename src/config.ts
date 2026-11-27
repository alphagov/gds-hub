import { z } from "zod";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const EDIT_MODES = ["off", "test"] as const;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  APP_VERSION: z.string().min(1).default("dev"),
  EDIT_MODE: z.enum(EDIT_MODES).default("off"),
  ALLOW_UNAUTHENTICATED_EDITING: z.enum(["yes"]).optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  DATABASE_HOST: z
    .string()
    .regex(/^[A-Za-z0-9.-]+$/, "must be a host name")
    .optional(),
  DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DATABASE_NAME: z.string().min(1).optional(),
  DATABASE_USER: z.string().min(1).optional(),
  DATABASE_PASSWORD: z.string().min(1).optional(),
});

const DATABASE_PARTS = [
  "DATABASE_HOST",
  "DATABASE_NAME",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Whether people can edit in the browser. "test" switches on editing without
 * checking who is signed in, for releases before sign-in is delivered.
 */
export type EditMode = (typeof EDIT_MODES)[number];

export interface Config {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly version: string;
  /** How many proxies sit between the internet and the app. 0 means none, so no forwarded header is trusted. */
  readonly trustProxyHops: number;
  readonly databaseUrl: string;
  readonly editMode: EditMode;
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

/**
 * Builds the application config from environment variables.
 * Throws a ConfigError listing every missing or invalid value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as unset so defaults and "required" checks apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = configSchema.safeParse(cleaned);

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  const databaseIssues = checkDatabaseSettings(result.data);
  if (databaseIssues.length > 0) {
    throw new ConfigError(databaseIssues);
  }

  const data = result.data;
  // Unauthenticated editing in production has to be asked for twice, so one
  // stray variable can't open the Hub to anyone who can reach it.
  if (
    data.NODE_ENV === "production" &&
    data.EDIT_MODE === "test" &&
    data.ALLOW_UNAUTHENTICATED_EDITING !== "yes"
  ) {
    throw new ConfigError([
      "EDIT_MODE: test in production also needs ALLOW_UNAUTHENTICATED_EDITING=yes",
    ]);
  }

  const databaseUrl = resolveDatabaseUrl(data);
  return Object.freeze({
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    version: data.APP_VERSION,
    trustProxyHops: data.TRUST_PROXY_HOPS,
    databaseUrl,
    editMode: data.EDIT_MODE,
  });
}

type ParsedEnv = z.infer<typeof configSchema>;

/**
 * Checks that the database is set either as DATABASE_URL or as its parts, not both.
 * The messages name variables only, never their values, because one is a password.
 */
function checkDatabaseSettings(data: ParsedEnv): string[] {
  const given = DATABASE_PARTS.filter((name) => data[name] !== undefined);

  if (data.DATABASE_URL !== undefined) {
    return given.length > 0
      ? [
          "DATABASE_URL: set either DATABASE_URL or the DATABASE_HOST, NAME, USER and PASSWORD parts, not both",
        ]
      : [];
  }
  if (given.length === 0) {
    return [
      "DATABASE_URL: required, or set DATABASE_HOST, DATABASE_NAME, DATABASE_USER and DATABASE_PASSWORD",
    ];
  }
  return DATABASE_PARTS.filter((name) => data[name] === undefined).map(
    (name) => `${name}: required when the database is set as parts`,
  );
}

/**
 * Returns DATABASE_URL, or builds one from the parts ECS passes to the tasks.
 * The URL asks for a verified TLS connection, so the certificate must match the host name
 * and chain to a CA that Node trusts (NODE_EXTRA_CA_CERTS holds the RDS bundle in the image).
 */
function resolveDatabaseUrl(data: ParsedEnv): string {
  if (data.DATABASE_URL !== undefined) {
    return data.DATABASE_URL;
  }
  const user = encodeURIComponent(data.DATABASE_USER ?? "");
  const password = encodeURIComponent(data.DATABASE_PASSWORD ?? "");
  const name = encodeURIComponent(data.DATABASE_NAME ?? "");
  return `postgres://${user}:${password}@${data.DATABASE_HOST ?? ""}:${String(data.DATABASE_PORT)}/${name}?sslmode=verify-full`;
}
