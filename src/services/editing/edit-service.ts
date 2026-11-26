import {
  EDIT_ENTITIES,
  type EditEntity,
  type EditEntityKey,
  type EditField,
  type EditRepositoryName,
  type EditValue,
  type EditValues,
} from "../../editing/entities.js";
import type { Repositories } from "../../repositories/index.js";
import type { Actor } from "../audit/actor.js";

export type { EditValue, EditValues } from "../../editing/entities.js";

/** A record in a list: its name, and when it was last changed. */
export interface EditRecord {
  readonly id: number;
  /** The record's name (or title). */
  readonly title: string;
  readonly updatedAt: Date;
}

/** A record with the value of each of its form fields, keyed by field name. */
export interface EditRecordDetail extends EditRecord {
  readonly values: EditValues;
}

/** One record to choose in a select. */
export interface ChoiceOption {
  /** The record's id, as the form sends it. */
  readonly value: string;
  readonly text: string;
}

/**
 * Reads and writes the records the editing pages cover. Every write goes
 * through a repository, which adds the audit entry in the same transaction,
 * so each takes the actor to record. Failures are RepositoryErrors.
 */
export interface EditService {
  /** Every record of a kind, by name. */
  list(entity: EditEntityKey): Promise<EditRecord[]>;
  find(entity: EditEntityKey, id: number): Promise<EditRecordDetail | undefined>;
  /** The records each of the form's choice fields can pick from, keyed by field name. */
  choices(entity: EditEntityKey): Promise<Readonly<Record<string, ChoiceOption[]>>>;
  create(entity: EditEntityKey, values: EditValues, actor: Actor): Promise<EditRecord>;
  /**
   * Saves changes. `expectedUpdatedAt` is when the editor's form was loaded:
   * if the record has changed since, nothing is written ("stale").
   */
  update(
    entity: EditEntityKey,
    id: number,
    values: EditValues,
    actor: Actor,
    expectedUpdatedAt: Date,
  ): Promise<EditRecord>;
  remove(
    entity: EditEntityKey,
    id: number,
    actor: Actor,
    expectedUpdatedAt: Date,
  ): Promise<EditRecord>;
}

/** The repositories the editing pages use. */
export type EditRepositories = Pick<Repositories, EditRepositoryName>;

type Row = Readonly<Record<string, unknown>>;

/** What every table's repository offers, with its rows as plain records. */
interface RowRepository {
  list(): Promise<Row[]>;
  getById(id: number): Promise<Row | undefined>;
  create(values: Row, actor: Actor): Promise<Row>;
  update(
    id: number,
    changes: Row,
    actor: Actor,
    options: { readonly expectedUpdatedAt: Date },
  ): Promise<{ readonly record: Row }>;
  remove(id: number, actor: Actor, options: { readonly expectedUpdatedAt: Date }): Promise<Row>;
}

function titleOf(entity: EditEntity, row: Row): string {
  const title = row[entity.titleField];
  if (typeof title !== "string") throw new Error("the record has no name");
  return title;
}

function summary(entity: EditEntity, row: Row): EditRecord {
  const { id, updatedAt } = row;
  if (typeof id !== "number" || !(updatedAt instanceof Date)) {
    throw new Error("the database returned a record with no id or update time");
  }
  return { id, title: titleOf(entity, row), updatedAt };
}

function valueOf(field: EditField, row: Row): EditValue {
  const stored = row[field.name];
  if (stored === undefined || stored === null) return field.kind === "checkbox" ? false : null;
  if (Array.isArray(stored)) return stored.filter((item) => typeof item === "string");
  if (typeof stored === "string" || typeof stored === "number" || typeof stored === "boolean") {
    return stored;
  }
  throw new Error(`the ${field.name} column holds a value the form can't show`);
}

/**
 * A page that is published has the time it first was. Editors don't type it:
 * it is set when the status becomes "published" and left alone after.
 */
function withPublishedAt(
  key: EditEntityKey,
  values: EditValues,
  alreadyPublishedAt: unknown,
): Readonly<Record<string, EditValue | Date>> {
  if (key !== "pages" || values.status !== "published" || alreadyPublishedAt instanceof Date) {
    return values;
  }
  return { ...values, publishedAt: new Date() };
}

export function createEditService(repositories: EditRepositories): EditService {
  // The repositories are typed by table. This is the one place they are
  // treated alike, as every editable table is read and written the same way.
  const byName = repositories as unknown as Readonly<Record<EditRepositoryName, RowRepository>>;
  const repositoryFor = (key: EditEntityKey): RowRepository =>
    byName[EDIT_ENTITIES[key].repository];

  async function list(key: EditEntityKey): Promise<EditRecord[]> {
    const entity: EditEntity = EDIT_ENTITIES[key];
    const rows = await repositoryFor(key).list();
    return rows.map((row) => summary(entity, row));
  }

  return {
    list,

    find: async (key, id) => {
      const entity: EditEntity = EDIT_ENTITIES[key];
      const row = await repositoryFor(key).getById(id);
      if (row === undefined) return undefined;
      const values = Object.fromEntries(
        entity.fields.map((field) => [field.name, valueOf(field, row)]),
      );
      return { ...summary(entity, row), values };
    },

    choices: async (key) => {
      const entity: EditEntity = EDIT_ENTITIES[key];
      const entries = await Promise.all(
        entity.fields.flatMap((field) =>
          field.kind === "choice"
            ? [
                list(field.source).then((records): [string, ChoiceOption[]] => [
                  field.name,
                  records.map((record) => ({ value: String(record.id), text: record.title })),
                ]),
              ]
            : [],
        ),
      );
      return Object.fromEntries(entries);
    },

    create: async (key, values, actor) => {
      const created = await repositoryFor(key).create(withPublishedAt(key, values, null), actor);
      return summary(EDIT_ENTITIES[key], created);
    },

    update: async (key, id, values, actor, expectedUpdatedAt) => {
      const repository = repositoryFor(key);
      const current = key === "pages" ? await repository.getById(id) : undefined;
      const changes = withPublishedAt(key, values, current?.publishedAt);
      const { record } = await repository.update(id, changes, actor, { expectedUpdatedAt });
      return summary(EDIT_ENTITIES[key], record);
    },

    remove: async (key, id, actor, expectedUpdatedAt) => {
      const removed = await repositoryFor(key).remove(id, actor, { expectedUpdatedAt });
      return summary(EDIT_ENTITIES[key], removed);
    },
  };
}
