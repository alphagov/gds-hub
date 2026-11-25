import type { Request, RequestHandler } from "express";
import { HttpError } from "../lib/http-error.js";
import type { Actor } from "../services/audit/actor.js";

/** Who is making an edit, and whether that has been checked. */
export interface EditorIdentity {
  /** Recorded in the audit log against every change. */
  readonly actor: Actor;
  /** True only when the provider has checked who the editor is (for example a verified JWT). */
  readonly verified: boolean;
}

/**
 * Decides who is editing. This is the one place editing asks "who is this?":
 * test mode answers with a fixed, unverified actor, and a provider that
 * verifies the Lambda@Edge JWT (or a later identity provider) can replace it
 * without any change to the routes.
 */
export interface EditorIdentityProvider {
  /**
   * The editor making the request, or undefined to refuse it. A provider
   * that can't tell (for example, its key server is unreachable) should
   * reject, never return an identity.
   */
  identify(req: Request): Promise<EditorIdentity | undefined>;
}

/**
 * Asks the provider on every request and puts the editor on
 * `res.locals.editor`, with the request's ID added to their actor. A request
 * the provider doesn't identify is refused with a 403, and a provider that
 * fails passes the failure on, so the request never goes ahead unidentified.
 */
export function requireEditor(provider: EditorIdentityProvider): RequestHandler {
  return (req, res, next) => {
    provider.identify(req).then(
      (identity) => {
        if (identity === undefined) {
          next(new HttpError(403));
          return;
        }
        res.locals.editor = {
          verified: identity.verified,
          actor: { ...identity.actor, requestId: res.locals.requestId },
        };
        next();
      },
      (error: unknown) => {
        next(error);
      },
    );
  };
}
