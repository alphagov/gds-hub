import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createJsonLogger } from "../../src/lib/logger.js";
import { requestId } from "../../src/middleware/request-id.js";
import { requestLogger } from "../../src/middleware/request-logger.js";
import { startApp, type RunningApp } from "./helpers.js";

describe("requestLogger middleware", () => {
  let running: RunningApp;
  let lines: Record<string, unknown>[];
  let healthStatus: number;

  beforeAll(async () => {
    const logger = createJsonLogger({
      level: "info",
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    });
    const app = express();
    app.use(requestId(logger));
    app.use(requestLogger());
    app.get("/health", (_req, res) => {
      res.sendStatus(healthStatus);
    });
    app.get("/page", (_req, res) => {
      res.send("ok");
    });
    running = await startApp(app);
  });

  afterAll(async () => {
    await running.close();
  });

  beforeEach(() => {
    lines = [];
    healthStatus = 200;
  });

  // The log line is written on "finish", which can land just after the
  // client has read the response.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("logs a completed request with its method, path and status", async () => {
    await fetch(`${running.baseUrl}/page`);
    await settle();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: "request completed",
      method: "GET",
      path: "/page",
      status: 200,
    });
  });

  it("does not log a successful health check", async () => {
    await fetch(`${running.baseUrl}/health`);
    await settle();
    expect(lines).toEqual([]);
  });

  it("logs a failed health check", async () => {
    healthStatus = 503;
    await fetch(`${running.baseUrl}/health`);
    await settle();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ path: "/health", status: 503 });
  });
});
