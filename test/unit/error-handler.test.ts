import express, { type Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HttpError } from "../../src/lib/http-error.js";
import type { LogFields, Logger } from "../../src/lib/logger.js";
import { createRenderer, type Renderer } from "../../src/lib/render.js";
import { cspNonce } from "../../src/middleware/csp-nonce.js";
import { errorHandler, notFoundHandler } from "../../src/middleware/error-handler.js";
import { requestId } from "../../src/middleware/request-id.js";
import { ERROR_PAGES } from "../../src/site-map.js";
import { startApp, type RunningApp } from "./helpers.js";

type Level = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: Level;
  message: string;
  fields: LogFields | undefined;
}

function recordingLogger(entries: LogEntry[]): Logger {
  const at =
    (level: Level) =>
    (message: string, fields?: LogFields): void => {
      entries.push({ level, message, fields });
    };
  const logger: Logger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => logger,
  };
  return logger;
}

async function getBody(url: string): Promise<string> {
  const response: Response = await fetch(url);
  return response.text();
}

function headingPattern(text: string): RegExp {
  return new RegExp(`<h1[^>]*>\\s*${text}\\s*</h1>`);
}

function buildApp(renderer: Renderer, entries: LogEntry[]): Express {
  const app = express();
  app.use(requestId(recordingLogger(entries)));
  app.use(cspNonce());
  app.get("/forbidden", (_req, _res, next) => {
    next(new HttpError(403));
  });
  app.get("/fails", (_req, _res, next) => {
    next(new Error("boom"));
  });
  app.get("/fails-mid-response", (_req, res, next) => {
    res.status(200).type("text/plain");
    res.write("partial body");
    next(new Error("boom after headers"));
  });
  app.use(notFoundHandler());
  app.use(errorHandler(renderer));
  return app;
}

describe("error pages", () => {
  const entries: LogEntry[] = [];
  let running: RunningApp;

  beforeAll(async () => {
    running = await startApp(buildApp(createRenderer(), entries));
  });

  beforeEach(() => {
    entries.length = 0;
  });

  afterAll(async () => {
    await running.close();
  });

  it("shows the page not found page for an unknown address", async () => {
    const response: Response = await fetch(`${running.baseUrl}/no-such-page`);
    const html: string = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(html).toMatch(headingPattern(ERROR_PAGES[404].title));
    expect(html).toContain("If you typed the web address, check it is correct.");
  });

  it("shows the forbidden page for a 403", async () => {
    const response: Response = await fetch(`${running.baseUrl}/forbidden`);
    const html: string = await response.text();

    expect(response.status).toBe(403);
    expect(html).toMatch(headingPattern(ERROR_PAGES[403].title));
  });

  it("shows the server error page with the request ID and without the error details", async () => {
    const response: Response = await fetch(`${running.baseUrl}/fails`, {
      headers: { "x-request-id": "test-request-1" },
    });
    const html: string = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(html).toMatch(headingPattern(ERROR_PAGES[500].title));
    expect(html).toContain("test-request-1");
    expect(html).not.toContain("boom");
  });

  it("stops error pages from being cached", async () => {
    for (const path of ["/no-such-page", "/forbidden", "/fails"]) {
      const response: Response = await fetch(`${running.baseUrl}${path}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("closes the connection when the response has already started", async () => {
    // If the connection were left open the body would never end and this would time out.
    await expect(getBody(`${running.baseUrl}/fails-mid-response`)).rejects.toThrow();
  });

  it("logs unexpected errors at error level", async () => {
    await fetch(`${running.baseUrl}/fails`);
    await getBody(`${running.baseUrl}/fails-mid-response`).catch(() => undefined);

    const errors: LogEntry[] = entries.filter((entry) => entry.level === "error");
    expect(errors.map((entry) => entry.message)).toEqual(["unhandled error", "unhandled error"]);
    expect(errors.map((entry) => (entry.fields?.err as Error).message)).toEqual([
      "boom",
      "boom after headers",
    ]);
  });

  it("does not log not found or forbidden responses as errors", async () => {
    await fetch(`${running.baseUrl}/no-such-page`);
    await fetch(`${running.baseUrl}/forbidden`);

    expect(entries.filter((entry) => entry.level === "error")).toEqual([]);
  });
});

describe("error pages when the error template cannot be rendered", () => {
  const entries: LogEntry[] = [];
  let running: RunningApp;

  const brokenRenderer: Renderer = {
    renderToString: () => Promise.reject(new Error("template broken")),
    render: () => Promise.reject(new Error("template broken")),
  };

  beforeAll(async () => {
    running = await startApp(buildApp(brokenRenderer, entries));
  });

  afterAll(async () => {
    await running.close();
  });

  it("falls back to a plain-text 500 and logs both errors", async () => {
    const response: Response = await fetch(`${running.baseUrl}/fails`, {
      headers: { "x-request-id": "test-request-2" },
    });
    const body: string = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain(ERROR_PAGES[500].title);
    expect(body).toContain("test-request-2");

    const errors: LogEntry[] = entries.filter((entry) => entry.level === "error");
    expect(errors.map((entry) => (entry.fields?.err as Error).message)).toEqual([
      "boom",
      "template broken",
    ]);
  });
});
