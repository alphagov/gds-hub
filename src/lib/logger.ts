import type { LogLevel } from "../config.js";

export type LogFields = Record<string, unknown>;

/**
 * Structured logging interface used across the app.
 * Swap the implementation here when a logging library is chosen.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface JsonLoggerOptions {
  level: LogLevel;
  base?: LogFields;
  /** Where each JSON line is written. Defaults to stdout (stderr for errors). */
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
}

function defaultWrite(line: string, level: LogLevel): void {
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createJsonLogger(options: JsonLoggerOptions): Logger {
  const { level, base = {}, write = defaultWrite, now = () => new Date() } = options;
  const threshold = LEVEL_ORDER[level];

  const log = (entryLevel: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_ORDER[entryLevel] < threshold) return;
    const entry: LogFields = {
      time: now().toISOString(),
      level: entryLevel,
      msg: message,
    };
    for (const [key, value] of Object.entries({ ...base, ...fields })) {
      entry[key] = serialise(value);
    }
    write(JSON.stringify(entry), entryLevel);
  };

  return {
    debug: (message, fields) => {
      log("debug", message, fields);
    },
    info: (message, fields) => {
      log("info", message, fields);
    },
    warn: (message, fields) => {
      log("warn", message, fields);
    },
    error: (message, fields) => {
      log("error", message, fields);
    },
    child: (fields) => createJsonLogger({ level, base: { ...base, ...fields }, write, now }),
  };
}

/** A logger that discards everything. Useful in tests. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
