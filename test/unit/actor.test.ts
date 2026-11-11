import { describe, expect, it } from "vitest";
import {
  ActorError,
  assertValidActor,
  createActor,
  DATA_MIGRATION_ACTOR_EMAIL,
  systemActor,
} from "../../src/services/audit/actor.js";

describe("createActor", () => {
  it("builds an actor from an email address", () => {
    expect(createActor({ email: "editor@example.com" })).toEqual({ email: "editor@example.com" });
  });

  it("trims and lower-cases the email address", () => {
    expect(createActor({ email: "  Editor.Name@Example.COM " }).email).toBe(
      "editor.name@example.com",
    );
  });

  it("keeps the request ID when it is given", () => {
    expect(createActor({ email: "editor@example.com", requestId: "6f1c2a9e-request" })).toEqual({
      email: "editor@example.com",
      requestId: "6f1c2a9e-request",
    });
  });

  it("leaves out a request ID that is not given", () => {
    const actor = createActor({ email: "editor@example.com", requestId: undefined });
    expect(Object.keys(actor)).toEqual(["email"]);
  });

  it("rejects a blank email address", () => {
    expect(() => createActor({ email: "   " })).toThrow(ActorError);
  });

  it("rejects a value that is not an email address", () => {
    expect(() => createActor({ email: "not-an-email" })).toThrow(ActorError);
    expect(() => createActor({ email: "two words@example.com" })).toThrow(ActorError);
  });

  it("rejects an email address longer than 255 characters", () => {
    const email = `${"a".repeat(244)}@example.com`;
    expect(email.length).toBe(256);
    expect(() => createActor({ email })).toThrow(ActorError);
  });

  it("rejects an email address that claims to be a system actor", () => {
    expect(() => createActor({ email: DATA_MIGRATION_ACTOR_EMAIL })).toThrow(ActorError);
    expect(() => createActor({ email: "system:data_migration@example.com" })).toThrow(ActorError);
  });

  it("rejects a malformed request ID", () => {
    expect(() =>
      createActor({ email: "editor@example.com", requestId: "has spaces in it" }),
    ).toThrow(ActorError);
    expect(() => createActor({ email: "editor@example.com", requestId: "a".repeat(129) })).toThrow(
      ActorError,
    );
  });

  it("does not include the rejected value in the error message", () => {
    let message: string | undefined;
    try {
      createActor({ email: "private value" });
    } catch (error) {
      message = error instanceof Error ? error.message : undefined;
    }
    expect(message).toBeDefined();
    expect(message).not.toContain("private value");
  });
});

describe("systemActor", () => {
  it("builds the actor used by the data migration", () => {
    expect(systemActor("data_migration")).toEqual({ email: "system:data_migration" });
    expect(DATA_MIGRATION_ACTOR_EMAIL).toBe("system:data_migration");
  });
});

describe("assertValidActor", () => {
  it("accepts an actor built by createActor", () => {
    expect(() => {
      assertValidActor(createActor({ email: "editor@example.com", requestId: "request-1" }));
    }).not.toThrow();
  });

  it("accepts the data migration actor", () => {
    expect(() => {
      assertValidActor(systemActor("data_migration"));
    }).not.toThrow();
  });

  it("rejects an actor whose email is blank", () => {
    expect(() => {
      assertValidActor({ email: "" });
    }).toThrow(ActorError);
  });

  it("rejects an actor whose email is not an email address or a system actor", () => {
    expect(() => {
      assertValidActor({ email: "someone" });
    }).toThrow(ActorError);
    expect(() => {
      assertValidActor({ email: "system:" });
    }).toThrow(ActorError);
  });

  it("rejects an actor with a request ID the audit log can't store", () => {
    expect(() => {
      assertValidActor({ email: "editor@example.com", requestId: "a".repeat(129) });
    }).toThrow(ActorError);
  });
});
