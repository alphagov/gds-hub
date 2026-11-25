import { z } from "zod";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const EDIT_MODES = ["off", "test"] as const;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  APP_VERSION: z.string().min(1).default("dev"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  EDIT_MODE: z.enum(EDIT_MODES).default("off"),
});

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

  const data = result.data;
  return Object.freeze({
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    logLevel: data.LOG_LEVEL,
    version: data.APP_VERSION,
    databaseUrl: data.DATABASE_URL,
    editMode: data.EDIT_MODE,
  });
}
