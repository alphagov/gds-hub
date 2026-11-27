import {
  EDIT_ENTITIES,
  EDIT_ENTITY_KEYS,
  type EditEntity,
  type EditEntityKey,
  type EditField,
  type EditValue,
} from "../editing/entities.js";
import type { FormError } from "../editing/form.js";
import type {
  ChoiceOption,
  EditRecord,
  EditRecordDetail,
} from "../services/editing/edit-service.js";
import type {
  Breadcrumb,
  EditDeleteViewModel,
  EditFieldViewModel,
  EditFormViewModel,
  EditIndexViewModel,
  EditListViewModel,
  ErrorSummaryItem,
} from "../view-models.js";
import { EDIT_PATH } from "../site-map.js";
import { HOME_BREADCRUMB } from "./format.js";

// Builds the view models for the editing pages. Every value is plain text for
// the templates to escape.

export { EDIT_PATH };

export const editPaths = {
  list: (key: EditEntityKey) => `${EDIT_PATH}/${key}`,
  add: (key: EditEntityKey) => `${EDIT_PATH}/${key}/new`,
  record: (key: EditEntityKey, id: number) => `${EDIT_PATH}/${key}/${String(id)}`,
  delete: (key: EditEntityKey, id: number) => `${EDIT_PATH}/${key}/${String(id)}/delete`,
  /** What a preview's buttons post to. `id` is left out for a record not yet added. */
  preview: (key: EditEntityKey, id?: number) => stepPath(key, "preview", id),
  publish: (key: EditEntityKey, id?: number) => stepPath(key, "publish", id),
  /** Back to the form from a preview. */
  resume: (key: EditEntityKey, id?: number) => stepPath(key, "continue", id),
};

function stepPath(key: EditEntityKey, step: string, id?: number): string {
  return id === undefined
    ? `${EDIT_PATH}/${key}/${step}`
    : `${EDIT_PATH}/${key}/${String(id)}/${step}`;
}

/** What a change did, as the `saved` query parameter says after a redirect. */
export const SAVED_RESULTS = ["created", "updated", "deleted"] as const;
export type SavedResult = (typeof SAVED_RESULTS)[number];

/** The `saved` query value, if it is one the pages report. Anything else is ignored. */
export function savedResultFrom(value: unknown): SavedResult | undefined {
  return SAVED_RESULTS.find((result) => result === value);
}

const EDIT_BREADCRUMB: Breadcrumb = { text: "Edit", href: EDIT_PATH };

function listBreadcrumb(key: EditEntityKey): Breadcrumb {
  return { text: EDIT_ENTITIES[key].plural, href: editPaths.list(key) };
}

function successMessage(entity: EditEntity, result: SavedResult | undefined): string | null {
  return result === undefined ? null : `The ${entity.singular} was ${result}.`;
}

export function presentEditIndex(): EditIndexViewModel {
  return {
    title: "Edit the Hub",
    breadcrumbs: [HOME_BREADCRUMB],
    description: "Choose the kind of record to add or change.",
    items: EDIT_ENTITY_KEYS.map((key) => ({
      text: EDIT_ENTITIES[key].plural,
      href: editPaths.list(key),
      description: EDIT_ENTITIES[key].description,
    })),
  };
}

export function presentEditList(
  key: EditEntityKey,
  records: readonly EditRecord[],
  saved: SavedResult | undefined,
): EditListViewModel {
  const entity: EditEntity = EDIT_ENTITIES[key];
  return {
    title: entity.plural,
    breadcrumbs: [HOME_BREADCRUMB, EDIT_BREADCRUMB],
    success: successMessage(entity, saved),
    add: { text: `Add a ${entity.singular}`, href: editPaths.add(key) },
    items: records.map((record) => ({
      text: record.title,
      href: editPaths.record(key, record.id),
    })),
    emptyText: `There are no ${entity.plural.toLowerCase()} yet.`,
  };
}

/** What a form field shows as text. */
function shown(value: EditValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

function fieldViewModel(
  field: EditField,
  value: string,
  choices: readonly ChoiceOption[],
  errorText: string | undefined,
): EditFieldViewModel {
  const common = {
    id: field.name,
    name: field.name,
    label: { text: field.label, classes: "govuk-label--s" },
    ...(field.hint === undefined ? {} : { hint: { text: field.hint } }),
    ...(errorText === undefined ? {} : { errorMessage: { text: errorText } }),
  };
  const required = "required" in field && field.required;

  switch (field.kind) {
    case "text":
      return {
        component: "input",
        params: {
          ...common,
          value,
          ...(field.width === "two-thirds" ? { classes: "govuk-!-width-two-thirds" } : {}),
        },
      };
    case "slug":
    case "date":
    case "integer":
      return {
        component: "input",
        params: {
          ...common,
          value,
          classes: field.kind === "slug" ? "govuk-!-width-two-thirds" : "govuk-input--width-10",
          spellcheck: false,
        },
      };
    case "textarea":
      return { component: "textarea", params: { ...common, value, rows: field.rows ?? 4 } };
    case "lines":
      return { component: "textarea", params: { ...common, value, rows: 4, spellcheck: false } };
    case "markdown":
      return {
        component: "textarea",
        params: { ...common, value, rows: field.rows ?? 15, spellcheck: true },
      };
    case "select": {
      // A select that has to be chosen and starts on a value needs no blank option.
      const withBlank = !required || field.defaultValue === undefined;
      return {
        component: "select",
        params: {
          ...common,
          items: [
            ...(withBlank
              ? [{ value: "", text: required ? `Select the ${field.label.toLowerCase()}` : "None" }]
              : []),
            ...field.options.map((option) => ({ ...option, selected: option.value === value })),
          ],
        },
      };
    }
    case "choice":
      return {
        component: "select",
        params: {
          ...common,
          items: [
            { value: "", text: required ? `Select a ${field.label.toLowerCase()}` : "None" },
            ...choices.map((choice) => ({ ...choice, selected: choice.value === value })),
          ],
        },
      };
    case "checkbox":
      return {
        component: "checkboxes",
        params: {
          idPrefix: field.name,
          name: field.name,
          ...(errorText === undefined ? {} : { errorMessage: { text: errorText } }),
          items: [{ value: "true", text: field.label, checked: value === "true" }],
        },
      };
  }
}

export interface EditFormInput {
  readonly key: EditEntityKey;
  /** The record being changed, or undefined to add one. */
  readonly record?: EditRecordDetail | undefined;
  readonly choices: Readonly<Record<string, readonly ChoiceOption[]>>;
  /** What was typed, when the form is shown again after a problem. */
  readonly submitted?: Readonly<Record<string, string>> | undefined;
  /** When the form being shown was loaded. Kept from the original form after a problem. */
  readonly updatedAt?: string | undefined;
  readonly errors?: readonly FormError[];
  /** Problems that aren't about one field. */
  readonly problems?: readonly string[];
  readonly saved?: SavedResult | undefined;
  /** The record has been changed since the form was loaded. */
  readonly stale?: boolean;
}

export function presentEditForm({
  key,
  record,
  choices,
  submitted,
  updatedAt,
  errors = [],
  problems = [],
  saved,
  stale = false,
}: EditFormInput): EditFormViewModel {
  const entity: EditEntity = EDIT_ENTITIES[key];
  const errorFor = new Map(errors.map((error) => [error.field, error.message]));
  const fields = entity.fields.filter((field) => record === undefined || field.kind !== "slug");

  const slugValue = record?.values.slug;
  const summary: ErrorSummaryItem[] = [
    ...problems.map((text) => ({ text })),
    ...errors.map((error) => ({ text: error.message, href: `#${error.field}` })),
  ];

  const initial = (field: EditField): string => {
    if (submitted !== undefined) return submitted[field.name] ?? "";
    if (record !== undefined) return shown(record.values[field.name]);
    return "defaultValue" in field ? (field.defaultValue ?? "") : "";
  };

  return {
    title: record === undefined ? `Add a ${entity.singular}` : record.title,
    caption: record === undefined ? null : `Edit ${entity.singular}`,
    breadcrumbs: [HOME_BREADCRUMB, EDIT_BREADCRUMB, listBreadcrumb(key)],
    hasError: summary.length > 0,
    success: successMessage(entity, saved),
    errors: summary,
    action: record === undefined ? editPaths.list(key) : editPaths.record(key, record.id),
    updatedAt: record === undefined ? null : (updatedAt ?? record.updatedAt.toISOString()),
    slug:
      record === undefined || typeof slugValue !== "string"
        ? null
        : { key: { text: "Slug" }, value: { text: slugValue } },
    fields: fields.map((field) =>
      fieldViewModel(field, initial(field), choices[field.name] ?? [], errorFor.get(field.name)),
    ),
    cancel: { text: "Cancel", href: editPaths.list(key) },
    previewAction:
      record === undefined ? editPaths.preview(key) : editPaths.preview(key, record.id),
    latest:
      stale && record !== undefined
        ? { text: "Open the latest version", href: editPaths.record(key, record.id) }
        : null,
    delete:
      record === undefined
        ? null
        : { text: `Delete this ${entity.singular}`, href: editPaths.delete(key, record.id) },
  };
}

export function presentEditDelete(
  key: EditEntityKey,
  record: EditRecord,
  problems: readonly string[] = [],
): EditDeleteViewModel {
  const entity: EditEntity = EDIT_ENTITIES[key];
  return {
    title: `Delete ${record.title}`,
    caption: `Delete ${entity.singular}`,
    breadcrumbs: [HOME_BREADCRUMB, EDIT_BREADCRUMB, listBreadcrumb(key)],
    hasError: problems.length > 0,
    errors: problems.map((text) => ({ text })),
    action: editPaths.delete(key, record.id),
    updatedAt: record.updatedAt.toISOString(),
    cancel: { text: "Cancel", href: editPaths.record(key, record.id) },
  };
}
