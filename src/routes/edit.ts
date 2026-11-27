import express, { Router, type Request, type RequestHandler, type Response } from "express";
import { refuseCrossSiteWrites } from "../editing/cross-site.js";
import { requireEditor, type EditorIdentityProvider } from "../editing/editor-identity.js";
import { EDIT_ENTITIES, editEntityFrom, type EditEntityKey } from "../editing/entities.js";
import { parseForm, type FormError, type ParsedForm } from "../editing/form.js";
import type { PreviewPayload, PreviewSigner } from "../editing/preview-signing.js";
import { HttpError } from "../lib/http-error.js";
import type { Renderer } from "../lib/render.js";
import {
  presentPreview,
  presentPreviewBanner,
  presentPreviewProblem,
} from "../presenters/preview.js";
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
import type { CatalogueService } from "../services/catalogue/catalogue-service.js";
import type { ContentService } from "../services/content/content-service.js";
import type { EditService } from "../services/editing/edit-service.js";
import { createPreviewService } from "../services/editing/preview-service.js";

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

const DELETE_STALE_PROBLEM =
  "This record was changed by someone else since you opened this page, so it was not deleted. Check the latest version, then delete it again if you still want to.";

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
  signer: PreviewSigner,
  reading: { readonly catalogue: CatalogueService; readonly content: ContentService },
): Router {
  const router = Router();
  const previews = createPreviewService(reading.catalogue, reading.content, service);

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

  /** Adds a record from values that have passed the form's checks. */
  async function saveCreate(
    res: Response,
    key: EditEntityKey,
    parsed: Extract<ParsedForm, { ok: true }>,
  ): Promise<void> {
    try {
      const created = await service.create(key, parsed.values, actorOf(res));
      res.redirect(303, `${editPaths.record(key, created.id)}?saved=created`);
    } catch (error) {
      const failure = repositoryProblem(error, ["duplicate", "invalid_reference", "invalid_value"]);
      if (failure === undefined) throw error;
      await showForm(res, key, 400, {
        problems: [WRITE_PROBLEMS[failure.kind] ?? ""],
        submitted: parsed.submitted,
      });
    }
  }

  /** Saves changes from values that have passed the form's checks. */
  async function saveUpdate(
    res: Response,
    key: EditEntityKey,
    id: number,
    parsed: Extract<ParsedForm, { ok: true }>,
    loaded: { readonly date: Date; readonly text: string },
  ): Promise<void> {
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
  }

  /**
   * The payload of a preview, if this app made it for this editor and this
   * record and it is still fresh. If not, the problem page is shown (400) and
   * nothing is taken from the payload.
   */
  async function openPreview(
    req: Request,
    res: Response,
    key: EditEntityKey,
    id: number | undefined,
  ): Promise<PreviewPayload | undefined> {
    const body = formBody(req);
    const token =
      typeof body === "object" && body !== null && "preview" in body ? body.preview : undefined;
    const result =
      typeof token === "string"
        ? signer.verify(token, {
            entity: key,
            ...(id === undefined ? {} : { id }),
            actor: actorOf(res).email,
          })
        : undefined;
    // A saved record's payload also has to say when its form was loaded.
    const hasLoadTime =
      id === undefined ||
      (result?.ok === true &&
        result.payload.loadedAt !== undefined &&
        FORM_TIMESTAMP.test(result.payload.loadedAt));
    if (result?.ok !== true || !hasLoadTime) {
      await renderer.render(res, "edit/problem.njk", presentPreviewProblem(key, id), 400);
      return undefined;
    }
    return result.payload;
  }

  // A preview, and the two things an editor can do with it. They come before
  // the routes that take an id, so "preview" is never read as one.
  for (const withId of [false, true]) {
    const base = withId ? "/edit/:entity/:id" : "/edit/:entity";
    const idOf = (req: Request): number | undefined => (withId ? idFrom(req) : undefined);

    router.post(
      `${base}/preview`,
      form,
      route(async (req, res) => {
        res.set("X-Robots-Tag", "noindex, nofollow");
        const key = entityFrom(req);
        const id = idOf(req);
        const body = formBody(req);
        const loaded = id === undefined ? undefined : loadedAt(body);
        const parsed = parseForm(EDIT_ENTITIES[key], body, id === undefined ? "create" : "update");
        if (!parsed.ok) {
          await showForm(res, key, 400, {
            ...parsed,
            ...(id === undefined ? {} : { id }),
            ...(loaded === undefined ? {} : { updatedAt: loaded.text }),
          });
          return;
        }
        const data = await previews.build(key, id, parsed.values);
        const token = signer.sign({
          entity: key,
          ...(id === undefined || loaded === undefined ? {} : { id, loadedAt: loaded.text }),
          actor: actorOf(res).email,
          values: parsed.submitted,
        });
        const shown = presentPreview(
          data,
          presentPreviewBanner(key, id, token, data.kind === "pages" && data.notShownToReaders),
        );
        switch (shown.template) {
          case "pages/vendor.njk":
            await renderer.render(res, shown.template, shown.page);
            break;
          case "pages/tool.njk":
            await renderer.render(res, shown.template, shown.page);
            break;
          case "pages/instance.njk":
            await renderer.render(res, shown.template, shown.page);
            break;
          case "pages/product-team-service.njk":
            await renderer.render(res, shown.template, shown.page);
            break;
          case "pages/content-page.njk":
            await renderer.render(res, shown.template, shown.page);
            break;
        }
      }),
    );

    router.post(
      `${base}/publish`,
      form,
      route(async (req, res) => {
        const key = entityFrom(req);
        const id = idOf(req);
        const payload = await openPreview(req, res, key, id);
        if (payload === undefined) return;
        // The values are checked again: the signature shows who made the payload, not that it is valid.
        const parsed = parseForm(
          EDIT_ENTITIES[key],
          payload.values,
          id === undefined ? "create" : "update",
        );
        if (id === undefined) {
          if (parsed.ok) await saveCreate(res, key, parsed);
          else await showForm(res, key, 400, parsed);
          return;
        }
        const text = payload.loadedAt ?? "";
        if (parsed.ok) await saveUpdate(res, key, id, parsed, { date: new Date(text), text });
        else await showForm(res, key, 400, { ...parsed, id, updatedAt: text });
      }),
    );

    router.post(
      `${base}/continue`,
      form,
      route(async (req, res) => {
        const key = entityFrom(req);
        const id = idOf(req);
        const payload = await openPreview(req, res, key, id);
        if (payload === undefined) return;
        await showForm(res, key, 200, {
          ...(id === undefined ? {} : { id, updatedAt: payload.loadedAt ?? "" }),
          submitted: payload.values,
        });
      }),
    );
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
      await saveCreate(res, key, parsed);
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
      await saveUpdate(res, key, id, parsed, loaded);
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
    form,
    route(async (req, res) => {
      const key = entityFrom(req);
      const id = idFrom(req);
      const loaded = loadedAt(formBody(req));
      try {
        await service.remove(key, id, actorOf(res), loaded.date);
        res.redirect(303, `${editPaths.list(key)}?saved=deleted`);
      } catch (error) {
        const failure = repositoryProblem(error, ["in_use", "stale"]);
        if (failure === undefined) throw error;
        await showDelete(
          res,
          key,
          id,
          failure.kind === "stale"
            ? DELETE_STALE_PROBLEM
            : `This ${EDIT_ENTITIES[key].singular} is still in use, so it can’t be deleted. Remove it from whatever uses it first.`,
        );
      }
    }),
  );

  return router;
}
