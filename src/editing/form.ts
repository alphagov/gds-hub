import type { EditEntity, EditField, EditValue, EditValues } from "./entities.js";

// Turns what a browser sent into the values to save, or into a list of
// problems to show next to the form. Messages name the field and never
// repeat what was typed. The checks on each value reuse the shared schemas
// in src/validation/catalogue.ts, so a value the database would refuse is
// refused here first.

export interface FormError {
  /** The field's name, which is also the id of its input. */
  readonly field: string;
  readonly message: string;
}

export type ParsedForm =
  | {
      readonly ok: true;
      readonly values: EditValues;
      /** What was typed in each of the form's own fields, to show again if the save fails. */
      readonly submitted: Readonly<Record<string, string>>;
    }
  | {
      readonly ok: false;
      readonly errors: readonly FormError[];
      /** What was typed in each of the form's own fields, to show again. */
      readonly submitted: Readonly<Record<string, string>>;
    };

export type FormMode = "create" | "update";

const MAX_LINE_LENGTH = 1000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_MARKDOWN_LENGTH = 100_000;
const MAX_LINES = 100;
const MAX_INTEGER = 2_147_483_647;

const RECORD_ID = /^[1-9]\d{0,14}$/;
const WHOLE_NUMBER = /^-?\d{1,10}$/;

/** What reading one field gave: a value, or what is wrong with it. */
type Read = { readonly value: EditValue } | { readonly problem: string };

const value = (read: EditValue): Read => ({ value: read });
const problem = (message: string): Read => ({ problem: message });

function lowerLabel(field: EditField): string {
  return field.label.charAt(0).toLowerCase() + field.label.slice(1);
}

/** Whether the text has a control character. Line breaks and tabs are allowed if asked for. */
function hasControlCharacter(text: string, allowLayout: boolean): boolean {
  for (const character of text) {
    if (allowLayout && (character === "\n" || character === "\t")) continue;
    if (/\p{Cc}/u.test(character)) return true;
  }
  return false;
}

function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function tooLong(field: EditField, limit: number): Read {
  return problem(`${field.label} must be ${limit.toLocaleString("en-GB")} characters or fewer`);
}

function required(field: EditField): Read {
  return problem(
    field.kind === "select" || field.kind === "choice"
      ? `Select the ${lowerLabel(field)}`
      : `Enter the ${lowerLabel(field)}`,
  );
}

const NO_CONTROL_CHARACTERS = (field: EditField): Read =>
  problem(`${field.label} must not contain control characters`);

function readText(field: EditField, raw: string): Read {
  const isRequired = "required" in field && field.required;
  switch (field.kind) {
    case "text":
    case "slug": {
      const text = raw.trim();
      if (hasControlCharacter(text, false)) return NO_CONTROL_CHARACTERS(field);
      const limit = field.kind === "text" ? (field.maxLength ?? MAX_LINE_LENGTH) : undefined;
      if (limit !== undefined && text.length > limit) return tooLong(field, limit);
      if (text === "") return field.kind === "slug" || isRequired ? required(field) : value(null);
      return value(text);
    }
    case "textarea": {
      const text = normaliseLineEndings(raw).trim();
      if (hasControlCharacter(text, true)) return NO_CONTROL_CHARACTERS(field);
      if (text.length > MAX_TEXT_LENGTH) return tooLong(field, MAX_TEXT_LENGTH);
      if (text === "") return isRequired ? required(field) : value(null);
      return value(text);
    }
    case "markdown": {
      const text = normaliseLineEndings(raw);
      if (hasControlCharacter(text, true)) return NO_CONTROL_CHARACTERS(field);
      if (text.length > MAX_MARKDOWN_LENGTH) return tooLong(field, MAX_MARKDOWN_LENGTH);
      if (text.trim() === "") return isRequired ? required(field) : value(null);
      return value(text);
    }
    case "select": {
      const text = raw.trim();
      if (text === "") return isRequired ? required(field) : value(null);
      return field.options.some((option) => option.value === text)
        ? value(text)
        : problem(`Select a valid ${lowerLabel(field)}`);
    }
    case "choice": {
      const text = raw.trim();
      if (text === "") return isRequired ? required(field) : value(null);
      return RECORD_ID.test(text)
        ? value(Number(text))
        : problem(`Select a valid ${lowerLabel(field)}`);
    }
    case "checkbox": {
      if (raw === "" || raw === "true") return value(raw === "true");
      return problem(`${field.label} is not valid`);
    }
    case "date": {
      const text = raw.trim();
      return text === "" ? value(null) : value(text);
    }
    case "integer": {
      const text = raw.trim();
      if (text === "") return value(null);
      const number = Number(text);
      return WHOLE_NUMBER.test(text) && Math.abs(number) <= MAX_INTEGER
        ? value(number)
        : problem(`${field.label} must be a whole number`);
    }
    case "lines": {
      const text = normaliseLineEndings(raw);
      if (hasControlCharacter(text, true)) return NO_CONTROL_CHARACTERS(field);
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      return lines.length > MAX_LINES
        ? problem(`${field.label} must have ${MAX_LINES} lines or fewer`)
        : value(lines);
    }
  }
}

/** What to say when a value was read but the shared schema refuses it. */
function invalidMessage(field: EditField): string {
  switch (field.kind) {
    case "slug":
      return `${field.label} must be lower-case words separated by single hyphens`;
    case "date":
      return `${field.label} must be a real date written as YYYY-MM-DD`;
    case "lines":
      return `Each line of ${lowerLabel(field)} must be a valid GitHub organisation name`;
    case "text":
      return field.format === "url"
        ? `${field.label} must start with http:// or https://, with no spaces`
        : `${field.label} is not valid`;
    default:
      return `${field.label} is not valid`;
  }
}

function readField(field: EditField, raw: unknown): Read {
  // Missing is the same as blank, which is how an unticked box arrives.
  if (raw === undefined) return readText(field, "");
  // Sent more than once, or as something other than text.
  if (typeof raw !== "string") return problem(`${field.label} is not valid`);
  return readText(field, raw);
}

/**
 * Reads the form for a kind of record. Only the entity's own fields are
 * read, so a body can't set other columns. A slug can be set when a record
 * is created and never changed: on update it is not read at all.
 */
export function parseForm(entity: EditEntity, body: unknown, mode: FormMode): ParsedForm {
  const input: Readonly<Record<string, unknown>> =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const fields = entity.fields.filter((field) => mode === "create" || field.kind !== "slug");

  const values: Record<string, EditValue> = {};
  const submitted: Record<string, string> = {};
  const errors: FormError[] = [];

  for (const field of fields) {
    const raw = Object.hasOwn(input, field.name) ? input[field.name] : undefined;
    submitted[field.name] = typeof raw === "string" ? raw : "";

    const read = readField(field, raw);
    if ("problem" in read) {
      errors.push({ field: field.name, message: read.problem });
      continue;
    }
    if (!field.schema.safeParse(read.value).success) {
      errors.push({ field: field.name, message: invalidMessage(field) });
      continue;
    }
    values[field.name] = read.value;
  }

  if (errors.length > 0) return { ok: false, errors, submitted };
  if (mode === "create" && entity.keyFromSlug === true) values.key = values.slug ?? null;
  return { ok: true, values, submitted };
}
