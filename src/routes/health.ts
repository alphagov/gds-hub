import { Router } from "express";

export interface HealthResponse {
  status: "ok";
  version: string;
  uptime: number;
}

export function healthRouter(version: string): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    const body: HealthResponse = {
      status: "ok",
      version,
      uptime: Math.round(process.uptime()),
    };
    res.set("Cache-Control", "no-store").json(body);
  });

  return router;
}
