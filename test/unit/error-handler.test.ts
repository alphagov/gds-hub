import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LogFields, Logger } from "../../src/lib/logger.js";
import { errorHandler } from "../../src/middleware/error-handler.js";
import { requestId } from "../../src/middleware/request-id.js";
import { startApp, type RunningApp } from "./helpers.js";

interface LoggedError {
  message: string;
  fields: LogFields | undefined;
}

function recordingLogger(errors: LoggedError[]): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, fields) => {
      errors.push({ message, fields });
    },
    child: () => logger,
  };
  return logger;
}

async function getBody(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}

describe("errorHandler middleware", () => {
  const errors: LoggedError[] = [];
  let running: RunningApp;

  beforeAll(async () => {
    const app = express();
    app.use(requestId(recordingLogger(errors)));
    app.get("/fails", (_req, _res, next) => {
      next(new Error("boom"));
    });
    app.get("/fails-mid-response", (_req, res, next) => {
      res.status(200).type("text/plain");
      res.write("partial body");
      next(new Error("boom after headers"));
    });
    app.use(errorHandler());
    running = await startApp(app);
  });

  beforeEach(() => {
    errors.length = 0;
  });

  afterAll(async () => {
    await running.close();
  });

  it("returns a 500 with the request ID when the response hasn't started", async () => {
    const response = await fetch(`${running.baseUrl}/fails`, {
      headers: { "x-request-id": "test-request-1" },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Internal server error",
      requestId: "test-request-1",
    });
  });

  it("closes the connection when the response has already started", async () => {
    // Without the fix the body never ends, so this would hang until the test times out.
    await expect(getBody(`${running.baseUrl}/fails-mid-response`)).rejects.toThrow();
  });

  it("logs the error in both cases", async () => {
    await fetch(`${running.baseUrl}/fails`);
    await getBody(`${running.baseUrl}/fails-mid-response`).catch(() => undefined);

    const messages = errors.map((entry) => entry.message);
    const errorMessages = errors.map((entry) => (entry.fields?.err as Error).message);
    expect(messages).toEqual(["unhandled error", "unhandled error"]);
    expect(errorMessages).toEqual(["boom", "boom after headers"]);
  });
});
