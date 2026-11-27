import { describe, expect, it } from "vitest";
import {
  PREVIEW_LIFETIME_MINUTES,
  createPreviewSigner,
  type PreviewPayload,
} from "../../../src/editing/preview-signing.js";

// The signed payload that carries an editor's values from the preview to the
// save. Every secret and value here is invented for the test.

const SECRET = "test-secret-".padEnd(40, "x");
const OTHER_SECRET = "other-secret-".padEnd(40, "y");
const START = new Date("2026-11-27T10:00:00.000Z");

const payload: PreviewPayload = {
  entity: "vendors",
  id: 3,
  actor: "system:unauthenticated_test_mode",
  loadedAt: "2026-10-01T09:00:00.000Z",
  values: { name: "Compass Co", description: "Makes compasses." },
};
const expected = { entity: "vendors", id: 3, actor: payload.actor } as const;

function signerAt(now: Date, secret = SECRET) {
  return createPreviewSigner({ secret, now: () => now });
}

/** Changes one character in the middle of a string. */
function corrupt(text: string): string {
  const middle = Math.floor(text.length / 2);
  return `${text.slice(0, middle)}${text[middle] === "A" ? "B" : "A"}${text.slice(middle + 1)}`;
}

describe("createPreviewSigner", () => {
  it("refuses a secret that is too short to be safe", () => {
    expect(() => createPreviewSigner({ secret: "short" })).toThrow();
    expect(() => createPreviewSigner({ secret: "" })).toThrow();
  });

  it("gives back the values it signed", () => {
    const signer = signerAt(START);

    const result = signer.verify(signer.sign(payload), expected);

    expect(result).toEqual({ ok: true, payload });
  });

  it("works for a new record, which has no id", () => {
    const signer = signerAt(START);
    const { id: _id, loadedAt: _loadedAt, ...created } = payload;

    const result = signer.verify(signer.sign(created), { entity: "vendors", actor: payload.actor });

    expect(result).toEqual({ ok: true, payload: created });
  });

  it("makes a token that is safe to put in a hidden form field", () => {
    const token = createPreviewSigner({ secret: SECRET }).sign(payload);

    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("does not put the editor's values in the clear", () => {
    const token = createPreviewSigner({ secret: SECRET }).sign({
      ...payload,
      values: { name: "Visible words" },
    });

    expect(token).not.toContain("Visible words");
  });
});

describe("a payload that has been tampered with", () => {
  it("is refused when a value is changed", () => {
    const signer = signerAt(START);
    const [body, signature] = signer.sign(payload).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, values: { ...payload.values, name: "Evil Co" } }),
    ).toString("base64url");

    expect(signer.verify(`${forged}.${signature}`, expected).ok).toBe(false);
    expect(body).toBeTruthy();
  });

  it("is refused when the signature is changed", () => {
    const signer = signerAt(START);
    const [body, signature] = signer.sign(payload).split(".");

    expect(signer.verify(`${body}.${corrupt(signature ?? "")}`, expected).ok).toBe(false);
  });

  it("is refused when the body is changed", () => {
    const signer = signerAt(START);

    expect(signer.verify(corrupt(signer.sign(payload)), expected).ok).toBe(false);
  });

  it("is refused when the signature is removed or cut short", () => {
    const signer = signerAt(START);
    const [body, signature] = signer.sign(payload).split(".");

    expect(signer.verify(body ?? "", expected).ok).toBe(false);
    expect(signer.verify(`${body}.`, expected).ok).toBe(false);
    expect(signer.verify(`${body}.${(signature ?? "").slice(0, 10)}`, expected).ok).toBe(false);
  });

  it.each(["", "not a token", ".", "a.b.c", "{}", "null", "A".repeat(100_000)])(
    "is refused when it is not a token at all: %j",
    (junk) => {
      expect(signerAt(START).verify(junk, expected).ok).toBe(false);
    },
  );

  it("is refused when it was signed with another secret", () => {
    const token = signerAt(START, OTHER_SECRET).sign(payload);

    expect(signerAt(START).verify(token, expected).ok).toBe(false);
  });
});

describe("a payload used somewhere it was not made for", () => {
  it("is refused for another kind of record", () => {
    const signer = signerAt(START);

    expect(signer.verify(signer.sign(payload), { ...expected, entity: "tools" }).ok).toBe(false);
  });

  it("is refused for another record", () => {
    const signer = signerAt(START);

    expect(signer.verify(signer.sign(payload), { ...expected, id: 4 }).ok).toBe(false);
  });

  it("is refused for a new record when it was made for an existing one", () => {
    const signer = signerAt(START);

    expect(
      signer.verify(signer.sign(payload), { entity: "vendors", actor: payload.actor }).ok,
    ).toBe(false);
  });

  it("is refused for another editor, so a token can't be passed on", () => {
    const signer = signerAt(START);

    expect(
      signer.verify(signer.sign(payload), { ...expected, actor: "someone@example.com" }).ok,
    ).toBe(false);
  });
});

describe("how long a payload lasts", () => {
  const minutes = (count: number) => new Date(START.getTime() + count * 60_000);

  it("is still good just before it runs out", () => {
    const token = signerAt(START).sign(payload);

    expect(signerAt(minutes(PREVIEW_LIFETIME_MINUTES - 1)).verify(token, expected).ok).toBe(true);
  });

  it("is refused once it has run out", () => {
    const token = signerAt(START).sign(payload);

    expect(signerAt(minutes(PREVIEW_LIFETIME_MINUTES + 1)).verify(token, expected).ok).toBe(false);
  });

  it("is refused when its time is in the future", () => {
    const token = signerAt(minutes(60)).sign(payload);

    expect(signerAt(START).verify(token, expected).ok).toBe(false);
  });
});
