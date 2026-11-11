/**
 * Who made a change, as recorded in every audit_log entry.
 *
 * In the MVP `email` is the editor's email address from the verified
 * Lambda@Edge JWT, or a system actor such as "system:data_migration". It is
 * stored as both actor_name and actor_subject.
 */
export interface Actor {
  readonly email: string;
  /** The request that made the change, for tracing it in the logs. */
  readonly requestId?: string;
}

export interface ActorInput {
  readonly email: string;
  readonly requestId?: string | undefined;
}

/** The system actors, and the email recorded for each. */
export const SYSTEM_ACTORS = {
  data_migration: "system:data_migration",
} as const;

export type SystemActorName = keyof typeof SYSTEM_ACTORS;

/** Recorded for every change the migration from the current Hub makes. */
export const DATA_MIGRATION_ACTOR_EMAIL = SYSTEM_ACTORS.data_migration;

/** The length of audit_log.actor_name and actor_subject. */
const MAX_EMAIL_LENGTH = 255;
const SYSTEM_PREFIX = "system:";
// Deliberately loose: the address has already been checked by Google sign-in.
// This only stops values that are clearly not an email address.
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The same rule the request ID middleware applies. 128 is the length of
// audit_log.request_id.
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SYSTEM_ACTOR_EMAILS: ReadonlySet<string> = new Set(Object.values(SYSTEM_ACTORS));

/** An actor that can't be recorded. The message never includes the rejected value. */
export class ActorError extends Error {
  override readonly name = "ActorError";
}

function isEditorEmail(email: string): boolean {
  return (
    email.length <= MAX_EMAIL_LENGTH &&
    !email.startsWith(SYSTEM_PREFIX) &&
    EMAIL_ADDRESS.test(email)
  );
}

function checkedRequestId(requestId: string | undefined): string | undefined {
  if (requestId !== undefined && !REQUEST_ID.test(requestId)) {
    throw new ActorError("the request ID is not valid");
  }
  return requestId;
}

function actor(email: string, requestId: string | undefined): Actor {
  const checked = checkedRequestId(requestId);
  return checked === undefined ? { email } : { email, requestId: checked };
}

/**
 * The actor for an editor. The email is trimmed and lower-cased. Throws
 * ActorError if it isn't an email address, is too long for the audit log, or
 * claims to be a system actor.
 */
export function createActor(input: ActorInput): Actor {
  const email = input.email.trim().toLowerCase();
  if (email.startsWith(SYSTEM_PREFIX)) {
    throw new ActorError("an editor's email address can't be a system actor");
  }
  if (!isEditorEmail(email)) {
    throw new ActorError("the actor's email address is missing or not valid");
  }
  return actor(email, input.requestId);
}

/** The actor for a change made by the system itself, such as the data migration. */
export function systemActor(
  name: SystemActorName,
  options: { readonly requestId?: string | undefined } = {},
): Actor {
  return actor(SYSTEM_ACTORS[name], options.requestId);
}

/**
 * Checks an actor before a write, in case it was built without createActor.
 * Accepts an editor's email address or a known system actor.
 */
export function assertValidActor(value: Actor): void {
  if (!isEditorEmail(value.email) && !SYSTEM_ACTOR_EMAILS.has(value.email)) {
    throw new ActorError("the actor's email address is missing or not valid");
  }
  checkedRequestId(value.requestId);
}
