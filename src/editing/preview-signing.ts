import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// The signed payload that carries an editor's values from the preview to the
// save. The values are what was typed, as text, and are checked again when
// they are saved: the signature only shows that this app made the payload for
// this editor and this record, not that the values are valid.

/** How long a preview can be saved after it was made. */
export const PREVIEW_LIFETIME_MINUTES = 30;

const MIN_SECRET_LENGTH = 32;
// Allows for a little difference between the clocks of servers behind one load balancer.
const CLOCK_SKEW_MS = 60_000;
const MAX_TOKEN_LENGTH = 1_000_000;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface PreviewPayload {
  /** The kind of record, such as "vendors". */
  readonly entity: string;
  /** The record being changed. Absent when the preview is of a record not yet added. */
  readonly id?: number;
  /** Who made the preview. Only they can save it. */
  readonly actor: string;
  /** When the editor's form was loaded (ISO 8601), so a save over a newer change is still refused. */
  readonly loadedAt?: string;
  /** What was typed in each field, as text. */
  readonly values: Readonly<Record<string, string>>;
}

/** What a payload has to be for: the route and the editor using it. */
export interface PreviewExpectation {
  readonly entity: string;
  readonly id?: number;
  readonly actor: string;
}

export type PreviewVerification =
  { readonly ok: true; readonly payload: PreviewPayload } | { readonly ok: false };

export interface PreviewSigner {
  sign(payload: PreviewPayload): string;
  verify(token: string, expected: PreviewExpectation): PreviewVerification;
}

export interface PreviewSignerOptions {
  readonly secret: string;
  /** For tests. */
  readonly now?: () => Date;
}

const signedBody = z.strictObject({
  entity: z.string(),
  id: z.number().int().positive().optional(),
  actor: z.string(),
  loadedAt: z.string().optional(),
  values: z.record(z.string(), z.string()),
  issuedAt: z.number().int(),
});

const REFUSED: PreviewVerification = { ok: false };

/** A signer using HMAC-SHA256. Throws if the secret is too short to be safe. */
export function createPreviewSigner({
  secret,
  now = () => new Date(),
}: PreviewSignerOptions): PreviewSigner {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `the preview signing secret must be at least ${String(MIN_SECRET_LENGTH)} characters`,
    );
  }

  const signatureOf = (body: string): string =>
    createHmac("sha256", secret).update(body).digest("base64url");

  return {
    sign(payload) {
      const body = Buffer.from(JSON.stringify({ ...payload, issuedAt: now().getTime() })).toString(
        "base64url",
      );
      return `${body}.${signatureOf(body)}`;
    },

    verify(token, expected) {
      if (token.length > MAX_TOKEN_LENGTH || !TOKEN_FORMAT.test(token)) return REFUSED;
      const [body = "", signature = ""] = token.split(".");

      // Compare the text, so a signature with extra or changed characters is refused.
      const wanted = Buffer.from(signatureOf(body));
      const given = Buffer.from(signature);
      if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return REFUSED;

      let parsed: z.infer<typeof signedBody>;
      try {
        const json: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        const result = signedBody.safeParse(json);
        if (!result.success) return REFUSED;
        parsed = result.data;
      } catch {
        return REFUSED;
      }

      const age = now().getTime() - parsed.issuedAt;
      if (age > PREVIEW_LIFETIME_MINUTES * 60_000 || age < -CLOCK_SKEW_MS) return REFUSED;
      if (
        parsed.entity !== expected.entity ||
        parsed.id !== expected.id ||
        parsed.actor !== expected.actor
      ) {
        return REFUSED;
      }

      const payload: PreviewPayload = {
        entity: parsed.entity,
        ...(parsed.id === undefined ? {} : { id: parsed.id }),
        actor: parsed.actor,
        ...(parsed.loadedAt === undefined ? {} : { loadedAt: parsed.loadedAt }),
        values: parsed.values,
      };
      return { ok: true, payload };
    },
  };
}
