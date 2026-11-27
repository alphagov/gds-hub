import type { Request, RequestHandler, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  createTestModeIdentity,
  TEST_MODE_ACTOR_EMAIL,
  TEST_MODE_WARNING,
} from "../../../src/editing/test-mode.js";
import {
  requireEditor,
  type EditorIdentityProvider,
} from "../../../src/editing/editor-identity.js";
import { HttpError } from "../../../src/lib/http-error.js";
import { assertValidActor, systemActor } from "../../../src/services/audit/actor.js";

async function settled(handler: RequestHandler, requestId?: string) {
  const res = { locals: { requestId: requestId ?? "request-1" } } as unknown as Response;
  return await new Promise<{ error: unknown; res: Response }>((resolve) => {
    void handler({} as Request, res, (error?: unknown) => {
      resolve({ error, res });
    });
  });
}

describe("test mode identity", () => {
  it("is not verified, and records a fixed system actor", async () => {
    const identity = await createTestModeIdentity().identify({} as Request);

    expect(identity?.verified).toBe(false);
    expect(identity?.actor.email).toBe(TEST_MODE_ACTOR_EMAIL);
    expect(TEST_MODE_ACTOR_EMAIL).toBe("system:unauthenticated_test_mode");
  });

  it("gives an actor the audit log accepts", async () => {
    const identity = await createTestModeIdentity().identify({} as Request);

    expect(() => {
      if (identity) assertValidActor(identity.actor);
    }).not.toThrow();
  });

  it("says plainly that nobody is signed in", () => {
    expect(TEST_MODE_WARNING).toMatch(/test mode/i);
    expect(TEST_MODE_WARNING).toMatch(/not signed in/i);
  });
});

describe("requireEditor", () => {
  it("puts the editor, with the request's ID on their actor, where routes read it", async () => {
    const provider: EditorIdentityProvider = {
      identify: () => Promise.resolve({ actor: systemActor("data_migration"), verified: true }),
    };

    const { error, res } = await settled(requireEditor(provider), "abc-123");

    expect(error).toBeUndefined();
    expect(res.locals.editor).toMatchObject({
      verified: true,
      actor: { email: "system:data_migration", requestId: "abc-123" },
    });
  });

  it("refuses a request the provider can't identify, so a real provider can say no", async () => {
    const provider: EditorIdentityProvider = { identify: () => Promise.resolve(undefined) };

    const { error, res } = await settled(requireEditor(provider));

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(403);
    expect(res.locals.editor).toBeUndefined();
  });

  it("passes a provider's failure on as an error, and never lets the request through", async () => {
    const failure = new Error("key server unreachable");
    const provider: EditorIdentityProvider = { identify: () => Promise.reject(failure) };

    const { error, res } = await settled(requireEditor(provider));

    expect(error).toBe(failure);
    expect(res.locals.editor).toBeUndefined();
  });

  it("asks the provider on every request", async () => {
    const identify = vi.fn(() =>
      Promise.resolve({ actor: systemActor("data_migration"), verified: false }),
    );
    const handler = requireEditor({ identify });

    await settled(handler);
    await settled(handler);

    expect(identify).toHaveBeenCalledTimes(2);
  });
});
