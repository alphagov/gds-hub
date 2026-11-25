import express, { Router, type Request, type RequestHandler, type Response } from "express";
import { refuseCrossSiteWrites } from "../editing/cross-site.js";
import { requireEditor, type EditorIdentityProvider } from "../editing/editor-identity.js";
import { EDIT_ENTITIES, editEntityFrom, type EditEntityKey } from "../editing/entities.js";
import { parseForm, type FormError } from "../editing/form.js";
import { HttpError } from "../lib/http-error.js";
import type { Renderer } from "../lib/render.js";
import {
  EDIT_PATH,
  editPaths,
  presentEditDelete,
  presentEditForm,
  presentEditIndex,
  presentEditList,
  savedResultFrom,
} from "../presenters/edit.js";
import { RepositoryError } from "../repositories/errors.js";
import type { Actor } from "../services/audit/actor.js";
import type { EditService } from "../services/editing/edit-service.js";

// The editing pages. They are only mounted when editing is switched on, and
// every response is Cache-Control: no-store.

// A record's id: a whole number that fits in a bigint column and in a JavaScript number.
const RECORD_ID = /^[1-9]\d{0,14}$/;
// What the edit form sends back, as ISO 8601 from Date.toISOString().
const FORM_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const FORM_BODY_LIMIT = "512kb";

/** A request the app can't make sense of, answered with a short plain-text 400. */
class BadRequestError extends Error {
  readonly status = 400;
}

/** The text for a failed write that the editor can put right. Anything else is a server error. */
const WRITE_PROBLEMS: Readonly<Partial<Record<RepositoryError["kind"], string>>> = {
  duplicate: "Another record already uses the same slug or name. Change it and save again.",
  invalid_reference: "A record you chose no longer exists. Choose another and save again.",
  invalid_value: "One of the values can’t be saved. Check what you entered and save again.",
};

const STALE_PROBLEM =
  "This record was changed by someone else since you opened it, so your changes were not saved. Open the latest version, then make your changes again.";

function entityFrom(req: Request): EditEntityKey {
  const key = editEntityFrom(req.params.entity);
  if (key === undefined) throw new HttpError(404);
  return key;
}

function idFrom(req: Request): number {
  const id: unknown = req.params.id;
  if (typeof id !== "string" || !RECORD_ID.test(id)) throw new HttpError(404);
  return Number(id);
}

/** The form's fields. Only form posts are accepted: anything else is a bad request. */
function formBody(req: Request): unknown {
  if (req.body === undefined || !req.is("application/x-www-form-urlencoded")) {
    throw new BadRequestError("expected form data");
  }
  return req.body;
}

/** When the editor's form was loaded, as the form says. A form without it is refused. */
function loadedAt(body: unknown): { date: Date; text: string } {
  const text =
    typeof body === "object" && body !== null && "updatedAt" in body ? body.updatedAt : undefined;
  if (typeof text !== "string" || !FORM_TIMESTAMP.test(text)) {
    throw new BadRequestError("the form does not say when the record was loaded");
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new BadRequestError("the form's time is not valid");
  return { date, text };
}

/** Who is editing, as requireEditor found. Every edit route runs after it. */
function actorOf(res: Response): Actor {
  const { editor } = res.locals;
  if (editor === undefined) throw new HttpError(403);
  return editor.actor;
}

function repositoryProblem(
  error: unknown,
  kinds: readonly RepositoryError["kind"][],
): RepositoryError | undefined {
  return error instanceof RepositoryError && kinds.includes(error.kind) ? error : undefined;
}

export function editRouter(
  renderer: Renderer,
  identity: EditorIdentityProvider,
  service: EditService,
): Router {
  const router = Router();

  /**
   * Runs an async handler, passing any failure to the error handler. A
   * record that has gone is page not found.
   */
  function route(handle: (req: Request, res: Response) => Promise<void>): RequestHandler {
    return (req, res, next) => {
      handle(req, res).catch((error: unknown) => {
        const gone = error instanceof RepositoryError && error.kind === "not_found";
        next(gone ? new HttpError(404) : error);
      });
    };
  }

  // Only /edit addresses: the router is mounted at the root, so these must not
  // touch other requests, such as old addresses that redirect.
  router.use(EDIT_PATH, (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(EDIT_PATH, refuseCrossSiteWrites());
  router.use(EDIT_PATH, requireEditor(identity));

  const form = express.urlencoded({ extended: false, limit: FORM_BODY_LIMIT });

  /** Shows the form again, with what is wrong and what was typed. */
  async function showForm(
    res: Response,
    key: EditEntityKey,
    status: number,
    input: {
      readonly id?: number;
      readonly errors?: readonly FormError[];
      readonly problems?: readonly string[];
      readonly submitted: Readonly<Record<string, string>>;
      readonly updatedAt?: string;
      readonly stale?: boolean;
    },
  ): Promise<void> {
    const [record, choices] = await Promise.all([
      input.id === undefined ? undefined : service.find(key, input.id),
      service.choices(key),
    ]);
    if (input.id !== undefined && record === undefined) throw new HttpError(404);
    await renderer.render(
      res,
      "edit/form.njk",
      presentEditForm({ key, record, choices, ...input }),
      status,
    );
  }

  /** Shows the delete confirmation again with a problem. */
  async function showDelete(
    res: Response,
    key: EditEntityKey,
    id: number,
    problem: string,
  ): Promise<void> {
    const record = await service.find(key, id);
    if (record === undefined) throw new HttpError(404);
    await renderer.render(res, "edit/delete.njk", presentEditDelete(key, record, [problem]), 409);
  }

  router.get(EDIT_PATH, (_req, res, next) => {
    renderer.render(res, "edit/index.njk", presentEditIndex()).catch(next);
  });

  router.get(
    "/edit/:entity",
    route(async (req, res) => {
      const key = entityFrom(req);
      const records = await service.list(key);
      await renderer.render(
        res,
        "edit/list.njk",
        presentEditList(key, records, savedResultFrom(req.query.saved)),
      );
    }),
  );

  router.get(
    "/edit/:entity/new",
    route(async (req, res) => {
      const key = entityFrom(req);
      const choices = await service.choices(key);
      await renderer.render(res, "edit/form.njk", presentEditForm({ key, choices }));
    }),
  );

  router.post(
    "/edit/:entity",
    form,
    route(async (req, res) => {
      const key = entityFrom(req);
      const parsed = parseForm(EDIT_ENTITIES[key], formBody(req), "create");
      if (!parsed.ok) {
        await showForm(res, key, 400, parsed);
        return;
      }
      try {
        const created = await service.create(key, parsed.values, actorOf(res));
        res.redirect(303, `${editPaths.record(key, created.id)}?saved=created`);
      } catch (error) {
        const failure = repositoryProblem(error, [
          "duplicate",
          "invalid_reference",
          "invalid_value",
        ]);
        if (failure === undefined) throw error;
        await showForm(res, key, 400, {
          problems: [WRITE_PROBLEMS[failure.kind] ?? ""],
          submitted: parsed.submitted,
        });
      }
    }),
  );

  router.get(
    "/edit/:entity/:id",
    route(async (req, res) => {
      const key = entityFrom(req);
      const id = idFrom(req);
      const [record, choices] = await Promise.all([service.find(key, id), service.choices(key)]);
      if (record === undefined) throw new HttpError(404);
      await renderer.render(
        res,
        "edit/form.njk",
        presentEditForm({ key, record, choices, saved: savedResultFrom(req.query.saved) }),
      );
    }),
  );

  router.post(
    "/edit/:entity/:id",
    form,
    route(async (req, res) => {
      const key = entityFrom(req);
      const id = idFrom(req);
      const body = formBody(req);
      const loaded = loadedAt(body);
      const parsed = parseForm(EDIT_ENTITIES[key], body, "update");
      if (!parsed.ok) {
        await showForm(res, key, 400, { ...parsed, id, updatedAt: loaded.text });
        return;
      }
      try {
        await service.update(key, id, parsed.values, actorOf(res), loaded.date);
        res.redirect(303, `${editPaths.record(key, id)}?saved=updated`);
      } catch (error) {
        const failure = repositoryProblem(error, [
          "stale",
          "duplicate",
          "invalid_reference",
          "invalid_value",
        ]);
        if (failure === undefined) throw error;
        const stale = failure.kind === "stale";
        await showForm(res, key, stale ? 409 : 400, {
          id,
          problems: [stale ? STALE_PROBLEM : (WRITE_PROBLEMS[failure.kind] ?? "")],
          submitted: parsed.submitted,
          updatedAt: loaded.text,
          stale,
        });
      }
    }),
  );

  router.get(
    "/edit/:entity/:id/delete",
    route(async (req, res) => {
      const key = entityFrom(req);
      const record = await service.find(key, idFrom(req));
      if (record === undefined) throw new HttpError(404);
      await renderer.render(res, "edit/delete.njk", presentEditDelete(key, record));
    }),
  );

  router.post(
    "/edit/:entity/:id/delete",
    route(async (req, res) => {
      const key = entityFrom(req);
      const id = idFrom(req);
      try {
        await service.remove(key, id, actorOf(res));
        res.redirect(303, `${editPaths.list(key)}?saved=deleted`);
      } catch (error) {
        if (repositoryProblem(error, ["in_use"]) === undefined) throw error;
        await showDelete(
          res,
          key,
          id,
          `This ${EDIT_ENTITIES[key].singular} is still in use, so it can’t be deleted. Remove it from whatever uses it first.`,
        );
      }
    }),
  );

  return router;
}
