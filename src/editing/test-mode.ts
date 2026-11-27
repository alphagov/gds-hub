import { systemActor } from "../services/audit/actor.js";
import type { EditorIdentity, EditorIdentityProvider } from "./editor-identity.js";

/** Recorded in the audit log for every change made in test mode. */
export const TEST_MODE_ACTOR_EMAIL = "system:unauthenticated_test_mode";

/** Shown on every edit page while the editor is not verified. */
export const TEST_MODE_WARNING =
  "Test mode: you are not signed in. Changes are saved straight away and recorded as unverified.";

/**
 * Identifies everyone as the same unverified system actor. Nothing the
 * editor types is recorded as who they are. Only for use before sign-in is
 * delivered: it checks nothing about the request.
 */
export function createTestModeIdentity(): EditorIdentityProvider {
  const identity: EditorIdentity = {
    actor: systemActor("unauthenticated_test_mode"),
    verified: false,
  };
  return { identify: () => Promise.resolve(identity) };
}
