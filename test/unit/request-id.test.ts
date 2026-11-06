import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLogger } from "../../src/lib/logger.js";
import { requestId } from "../../src/middleware/request-id.js";
import { startApp, type RunningApp } from "./helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("requestId middleware", () => {
  let running: RunningApp;

  beforeAll(async () => {
    const app = express();
    app.use(requestId(silentLogger));
    app.get("/", (_req, res) => {
      res.json({ id: res.locals.requestId });
    });
    running = await startApp(app);
  });

  afterAll(async () => {
    await running.close();
  });

  it("generates an ID and returns it in the header and res.locals", async () => {
    const response = await fetch(running.baseUrl);
    const header = response.headers.get("x-request-id");
    expect(header).toMatch(UUID);
    expect(await response.json()).toEqual({ id: header });
  });

  it("reuses a well-formed incoming ID", async () => {
    const response = await fetch(running.baseUrl, {
      headers: { "X-Request-Id": "abc-123.def_4" },
    });
    expect(response.headers.get("x-request-id")).toBe("abc-123.def_4");
  });

  it("replaces a malformed incoming ID", async () => {
    const response = await fetch(running.baseUrl, {
      headers: { "X-Request-Id": "bad id<script>" },
    });
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });
});
