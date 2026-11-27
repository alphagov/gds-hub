import type { RequestHandler } from "express";

const HEALTH_PATH = "/health";

/**
 * Logs one structured line per completed request. Successful health checks
 * are skipped, because the load balancer sends them every few seconds;
 * failed ones are still logged.
 */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      if (req.path === HEALTH_PATH && res.statusCode < 400) return;
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      res.locals.logger.info("request completed", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}
