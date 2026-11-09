import { describe, expect, it } from "vitest";
import { createJsonLogger } from "../../src/lib/logger.js";

function captureLogger(level: "debug" | "info" | "warn" | "error" = "debug") {
  const lines: Record<string, unknown>[] = [];
  const logger = createJsonLogger({
    level,
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { logger, lines };
}

describe("createJsonLogger", () => {
  it("writes one JSON line with time, level, message and fields", () => {
    const { logger, lines } = captureLogger();
    logger.info("hello", { answer: 42 });
    expect(lines).toEqual([
      {
        time: "2026-01-01T00:00:00.000Z",
        level: "info",
        msg: "hello",
        answer: 42,
      },
    ]);
  });

  it("drops entries below the configured level", () => {
    const { logger, lines } = captureLogger("warn");
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(lines.map((line) => line.msg)).toEqual(["c", "d"]);
  });

  it("includes parent fields in child loggers", () => {
    const { logger, lines } = captureLogger();
    logger.child({ requestId: "r1" }).child({ user: "u1" }).info("nested");
    expect(lines[0]).toMatchObject({
      requestId: "r1",
      user: "u1",
      msg: "nested",
    });
  });

  it("serialises errors with name, message and stack", () => {
    const { logger, lines } = captureLogger();
    logger.error("boom", { err: new TypeError("bad thing") });
    expect(lines[0]?.err).toMatchObject({
      name: "TypeError",
      message: "bad thing",
      stack: expect.any(String),
    });
  });
});
